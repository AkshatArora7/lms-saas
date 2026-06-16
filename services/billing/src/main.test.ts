import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  DEMO_TENANT_ID,
  MemoryPlanStore,
  MemorySubscriptionStore,
} from "./store.memory.js";
import { canTransition, seatCheck, type SubscriptionRecord } from "./store.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT_A = DEMO_TENANT_ID;
const TENANT_B = "22222222-2222-2222-2222-222222222222";

function build() {
  const planStore = new MemoryPlanStore();
  const subscriptionStore = new MemorySubscriptionStore(planStore);
  return { app: buildApp({ config, planStore, subscriptionStore }), subscriptionStore };
}

async function subscribe(
  app: ReturnType<typeof build>["app"],
  tenantId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: `/tenants/${tenantId}/subscription`,
    payload,
  });
}

describe("billing: lifecycle state machine (pure)", () => {
  it("allows valid transitions and blocks invalid ones", () => {
    expect(canTransition("trialing", "active")).toBe(true);
    expect(canTransition("active", "past_due")).toBe(true);
    expect(canTransition("past_due", "active")).toBe(true);
    expect(canTransition("active", "canceled")).toBe(true);
    expect(canTransition("canceled", "active")).toBe(false); // terminal
    expect(canTransition("trialing", "past_due")).toBe(false);
  });

  it("seatCheck treats null seats as unlimited", () => {
    const sub = { seats: null } as SubscriptionRecord;
    expect(seatCheck(sub, 9999).withinLimit).toBe(true);
    const limited = { seats: 10 } as SubscriptionRecord;
    expect(seatCheck(limited, 10).withinLimit).toBe(true);
    expect(seatCheck(limited, 11).withinLimit).toBe(false);
    expect(seatCheck(null, 1).withinLimit).toBe(true); // no subscription
  });
});

describe("billing service", () => {
  it("health reports ok", async () => {
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "billing", status: "ok" });
  });

  it("lists the plan catalog", async () => {
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/plans" });
    expect(res.statusCode).toBe(200);
    const codes = res.json().plans.map((p: { code: string }) => p.code);
    expect(codes).toContain("core");
    expect(codes).toContain("pro");
  });

  it("subscribes a tenant to a plan (trialing) and rejects unknown plans/ids", async () => {
    const { app } = build();
    const res = await subscribe(app, TENANT_A, { planCode: "pro", seats: 50 });
    expect(res.statusCode).toBe(201);
    expect(res.json().subscription).toMatchObject({
      planCode: "pro",
      status: "trialing",
      seats: 50,
    });

    expect(
      (await subscribe(app, TENANT_A, { planCode: "ghost" })).statusCode,
    ).toBe(400);
    expect((await subscribe(app, TENANT_A, {})).statusCode).toBe(400);
    expect((await subscribe(app, "not-a-uuid", { planCode: "core" })).statusCode).toBe(
      400,
    );
    expect(
      (await subscribe(app, TENANT_A, { planCode: "pro", seats: -1 })).statusCode,
    ).toBe(400);
  });

  it("404s when there is no subscription yet", async () => {
    const { app } = build();
    const res = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_A}/subscription`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("drives the subscription lifecycle and blocks invalid transitions", async () => {
    const { app } = build();
    await subscribe(app, TENANT_A, { planCode: "core" });

    const activate = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_A}/subscription/transition`,
      payload: { to: "active" },
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().subscription.status).toBe("active");

    const pastDue = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_A}/subscription/transition`,
      payload: { to: "past_due" },
    });
    expect(pastDue.statusCode).toBe(200);

    const canceled = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_A}/subscription/transition`,
      payload: { to: "canceled" },
    });
    expect(canceled.statusCode).toBe(200);

    // canceled is terminal -> cannot reactivate.
    const reactivate = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_A}/subscription/transition`,
      payload: { to: "active" },
    });
    expect(reactivate.statusCode).toBe(400);

    const badStatus = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_A}/subscription/transition`,
      payload: { to: "frozen" },
    });
    expect(badStatus.statusCode).toBe(400);
  });

  it("sets seats and enforces them via seat-check", async () => {
    const { app } = build();
    await subscribe(app, TENANT_A, { planCode: "pro", seats: 5 });

    const setSeats = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/subscription/seats`,
      payload: { seats: 3 },
    });
    expect(setSeats.statusCode).toBe(200);
    expect(setSeats.json().subscription.seats).toBe(3);

    const within = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_A}/subscription/seat-check?activeUsers=3`,
    });
    expect(within.json().check.withinLimit).toBe(true);

    const over = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_A}/subscription/seat-check?activeUsers=4`,
    });
    expect(over.json().check).toMatchObject({ withinLimit: false, seats: 3 });

    const badSeats = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/subscription/seats`,
      payload: { seats: 1.5 },
    });
    expect(badSeats.statusCode).toBe(400);
  });

  it("isolates subscriptions per tenant", async () => {
    const { app } = build();
    await subscribe(app, TENANT_A, { planCode: "pro", seats: 10 });
    const othersub = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_B}/subscription`,
    });
    expect(othersub.statusCode).toBe(404); // tenant B has none
  });
});
