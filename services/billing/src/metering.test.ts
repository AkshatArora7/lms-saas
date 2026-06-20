import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  DEMO_TENANT_ID,
  MemoryInvoiceStore,
  MemoryMeterStore,
  MemoryPlanStore,
  MemorySubscriptionStore,
} from "./store.memory.js";
import { computeInvoiceAmountCents, meteredMetric } from "./store.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const DISTRICT = DEMO_TENANT_ID;
const SCHOOL_A = "22222222-2222-2222-2222-222222222222";
const SCHOOL_B = "33333333-3333-3333-3333-333333333333";

function build() {
  const planStore = new MemoryPlanStore();
  const subscriptionStore = new MemorySubscriptionStore(planStore);
  const meterStore = new MemoryMeterStore();
  const invoiceStore = new MemoryInvoiceStore();
  // District -> two schools, for the consolidated roll-up.
  invoiceStore.seedParent(SCHOOL_A, DISTRICT);
  invoiceStore.seedParent(SCHOOL_B, DISTRICT);
  return {
    app: buildApp({ config, planStore, subscriptionStore, meterStore, invoiceStore }),
    invoiceStore,
  };
}

async function subscribe(
  app: ReturnType<typeof build>["app"],
  tenantId: string,
  planCode: string,
) {
  return app.inject({
    method: "POST",
    url: `/tenants/${tenantId}/subscription`,
    payload: { planCode },
  });
}

async function recordUsage(
  app: ReturnType<typeof build>["app"],
  tenantId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: `/tenants/${tenantId}/usage`,
    payload,
  });
}

describe("metering math (pure)", () => {
  it("maps billing models to metrics", () => {
    expect(meteredMetric("per_active_user")).toBe("active_users");
    expect(meteredMetric("per_fte")).toBe("fte");
    expect(meteredMetric("flat")).toBeNull();
  });
  it("flat bills the base; metered bills per whole unit", () => {
    expect(
      computeInvoiceAmountCents({
        basePriceCents: 50_000,
        billingModel: "flat",
        meteredQuantity: 99,
      }),
    ).toBe(50_000);
    expect(
      computeInvoiceAmountCents({
        basePriceCents: 500,
        billingModel: "per_active_user",
        meteredQuantity: 12.2,
      }),
    ).toBe(500 * 13); // ceil(12.2)
    expect(
      computeInvoiceAmountCents({
        basePriceCents: 500,
        billingModel: "per_active_user",
        meteredQuantity: 0,
      }),
    ).toBe(0);
  });
});

describe("usage metering & invoicing (#72)", () => {
  it("records usage and rolls it up, windowed and isolated by tenant", async () => {
    const { app } = build();
    await recordUsage(app, DISTRICT, {
      metric: "active_users",
      quantity: 10,
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-30T00:00:00.000Z",
    });
    await recordUsage(app, DISTRICT, {
      metric: "active_users",
      quantity: 5,
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-31T00:00:00.000Z",
    });
    // Another tenant's usage must not bleed in.
    await recordUsage(app, SCHOOL_A, {
      metric: "active_users",
      quantity: 99,
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-30T00:00:00.000Z",
    });

    const all = await app.inject({
      method: "GET",
      url: `/tenants/${DISTRICT}/usage/rollup?metric=active_users`,
    });
    expect(all.json().quantity).toBe(15);

    const june = await app.inject({
      method: "GET",
      url: `/tenants/${DISTRICT}/usage/rollup?metric=active_users&from=2026-06-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z`,
    });
    expect(june.json().quantity).toBe(10);
  });

  it("validates usage input", async () => {
    const { app } = build();
    expect((await recordUsage(app, DISTRICT, { quantity: 1, windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-06-30T00:00:00.000Z" })).statusCode).toBe(400);
    expect((await recordUsage(app, DISTRICT, { metric: "active_users", quantity: -1, windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-06-30T00:00:00.000Z" })).statusCode).toBe(400);
    expect((await recordUsage(app, DISTRICT, { metric: "active_users", quantity: 1, windowStart: "nope", windowEnd: "2026-06-30T00:00:00.000Z" })).statusCode).toBe(400);
  });

  it("generates an invoice from the subscription plan + metered usage", async () => {
    const { app } = build();
    await subscribe(app, SCHOOL_A, "core"); // per_active_user, base 0 -> 0
    await subscribe(app, SCHOOL_B, "pro"); // per_active_user, base 50000

    await recordUsage(app, SCHOOL_B, {
      metric: "active_users",
      quantity: 3,
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-30T00:00:00.000Z",
    });

    const inv = await app.inject({
      method: "POST",
      url: `/tenants/${SCHOOL_B}/invoices`,
      payload: {
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
      },
    });
    expect(inv.statusCode).toBe(201);
    expect(inv.json().meteredQuantity).toBe(3);
    expect(inv.json().invoice).toMatchObject({
      amountCents: 50_000 * 3,
      currency: "USD",
      status: "open",
      number: "INV-00001",
    });
  });

  it("404s an invoice when the tenant has no subscription", async () => {
    const { app } = build();
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${SCHOOL_A}/invoices`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("consolidates invoices across the district subtree", async () => {
    const { app } = build();
    await subscribe(app, SCHOOL_A, "pro");
    await subscribe(app, SCHOOL_B, "pro");
    await recordUsage(app, SCHOOL_A, {
      metric: "active_users",
      quantity: 2,
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-30T00:00:00.000Z",
    });
    await recordUsage(app, SCHOOL_B, {
      metric: "active_users",
      quantity: 4,
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-30T00:00:00.000Z",
    });
    await app.inject({ method: "POST", url: `/tenants/${SCHOOL_A}/invoices`, payload: {} });
    await app.inject({ method: "POST", url: `/tenants/${SCHOOL_B}/invoices`, payload: {} });

    const res = await app.inject({
      method: "GET",
      url: `/tenants/${DISTRICT}/invoices/consolidated`,
    });
    expect(res.statusCode).toBe(200);
    const c = res.json().consolidated;
    expect(c.districtTenantId).toBe(DISTRICT);
    expect(c.invoices).toHaveLength(2);
    expect(c.totalCents).toBe(50_000 * 2 + 50_000 * 4);
  });

  it("lists a tenant's own invoices only", async () => {
    const { app } = build();
    await subscribe(app, SCHOOL_A, "pro");
    await app.inject({ method: "POST", url: `/tenants/${SCHOOL_A}/invoices`, payload: {} });

    const a = await app.inject({ method: "GET", url: `/tenants/${SCHOOL_A}/invoices` });
    expect(a.json().invoices).toHaveLength(1);
    const b = await app.inject({ method: "GET", url: `/tenants/${SCHOOL_B}/invoices` });
    expect(b.json().invoices).toHaveLength(0);
  });
});
