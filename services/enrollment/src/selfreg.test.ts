import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { MemorySelfRegStore } from "./selfreg.memory.js";
import { DEMO_TENANT_ID } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};
const OTHER: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER.tenantId ? OTHER : TENANT;
}

function build(selfRegStore = new MemorySelfRegStore()) {
  return { app: buildApp({ config, selfRegStore, resolveTenant }), selfRegStore };
}

const H = { "x-tenant-id": DEMO_TENANT_ID };
const SECTION = "5ec00000-0000-0000-0000-000000000001";

async function setPolicy(
  app: ReturnType<typeof build>["app"],
  body: Record<string, unknown>,
) {
  return app.inject({
    method: "PUT",
    url: `/sections/${SECTION}/registration-policy`,
    headers: H,
    payload: body,
  });
}
async function register(
  app: ReturnType<typeof build>["app"],
  userId: string,
) {
  return app.inject({
    method: "POST",
    url: `/sections/${SECTION}/self-register`,
    headers: H,
    payload: { userId },
  });
}

describe("self-registration (#35)", () => {
  it("refuses to self-register a section that is not open (403)", async () => {
    const { app } = build();
    const res = await register(app, "u1");
    expect(res.statusCode).toBe(403); // no policy => closed
    await setPolicy(app, { isOpen: false });
    expect((await register(app, "u1")).statusCode).toBe(403);
  });

  it("self-enrolls immediately when open with no approval and capacity remains", async () => {
    const { app } = build();
    await setPolicy(app, { isOpen: true });
    const res = await register(app, "u1");
    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toBe("enrolled");

    // Re-registering once enrolled is a conflict.
    expect((await register(app, "u1")).statusCode).toBe(409);
  });

  it("queues a pending request when approval is required", async () => {
    const { app } = build();
    await setPolicy(app, { isOpen: true, requiresApproval: true });
    const res = await register(app, "u1");
    expect(res.statusCode).toBe(202);
    expect(res.json().outcome).toBe("pending");

    const pending = await app.inject({
      method: "GET",
      url: `/sections/${SECTION}/registration-requests?status=pending`,
      headers: H,
    });
    expect(pending.json().requests).toHaveLength(1);
  });

  it("wait-lists (pending) once capacity is reached", async () => {
    const { app } = build();
    await setPolicy(app, { isOpen: true, capacity: 1 });
    expect((await register(app, "u1")).json().outcome).toBe("enrolled"); // seat 1
    const second = await register(app, "u2");
    expect(second.statusCode).toBe(202);
    expect(second.json().outcome).toBe("pending"); // wait-listed
  });

  it("approves a pending request (enrolls) and denies another", async () => {
    const { app } = build();
    await setPolicy(app, { isOpen: true, requiresApproval: true });
    const reqId = (await register(app, "u1")).json().request.id;
    const denyId = (await register(app, "u2")).json().request.id;

    const approve = await app.inject({
      method: "POST",
      url: `/registration-requests/${reqId}/decide`,
      headers: H,
      payload: { decision: "approve", decidedBy: "admin-1" },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toMatchObject({ outcome: "enrolled" });
    expect(approve.json().request.status).toBe("approved");

    const deny = await app.inject({
      method: "POST",
      url: `/registration-requests/${denyId}/decide`,
      headers: H,
      payload: { decision: "deny" },
    });
    expect(deny.json()).toMatchObject({ outcome: "denied" });

    // Deciding an already-decided request is a conflict.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/registration-requests/${reqId}/decide`,
          headers: H,
          payload: { decision: "approve" },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("approval respects capacity (cannot exceed seats)", async () => {
    const { app } = build();
    await setPolicy(app, { isOpen: true, requiresApproval: true, capacity: 1 });
    const a = (await register(app, "u1")).json().request.id;
    const b = (await register(app, "u2")).json().request.id;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/registration-requests/${a}/decide`,
          headers: H,
          payload: { decision: "approve" },
        })
      ).json().outcome,
    ).toBe("enrolled"); // fills the only seat

    const second = await app.inject({
      method: "POST",
      url: `/registration-requests/${b}/decide`,
      headers: H,
      payload: { decision: "approve" },
    });
    expect(second.statusCode).toBe(409); // at_capacity
  });

  it("validates input and 404s an unknown request", async () => {
    const { app } = build();
    expect((await setPolicy(app, { capacity: -1 })).statusCode).toBe(400);
    await setPolicy(app, { isOpen: true });
    expect(
      (await app.inject({ method: "POST", url: `/sections/${SECTION}/self-register`, headers: H, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/registration-requests/99999999-9999-9999-9999-999999999999/decide`,
          headers: H,
          payload: { decision: "approve" },
        })
      ).statusCode,
    ).toBe(404);
  });
});
