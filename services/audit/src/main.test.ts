import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import {
  computeRowHash,
  verifyChain,
  type ChainableEntry,
  type ChainLink,
} from "./chain.js";
import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemoryAuditStore } from "./store.memory.js";

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
const OTHER_TENANT: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER_TENANT.tenantId ? OTHER_TENANT : TENANT;
}

function buildTestApp(store = new MemoryAuditStore()) {
  return buildApp({ config, store, resolveTenant });
}

const H = { "x-tenant-id": DEMO_TENANT_ID };
const OTHER_H = { "x-tenant-id": OTHER_TENANT.tenantId };

function entry(over: Partial<ChainableEntry> = {}): ChainableEntry {
  return {
    id: "e1",
    tenantId: DEMO_TENANT_ID,
    actorId: null,
    action: "user.login",
    targetType: null,
    targetId: null,
    metadata: {},
    ipAddress: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("hash chain (pure)", () => {
  it("computeRowHash is deterministic and key-order independent", () => {
    const a = entry({ metadata: { a: 1, b: 2 } });
    const b = entry({ metadata: { b: 2, a: 1 } });
    expect(computeRowHash(null, a)).toBe(computeRowHash(null, b));
    expect(computeRowHash(null, a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a different prev hash changes the row hash", () => {
    const e = entry();
    expect(computeRowHash(null, e)).not.toBe(computeRowHash("abcd", e));
  });

  it("verifyChain passes for an intact chain and flags a tampered field", () => {
    const e1 = entry({ id: "1" });
    const link1: ChainableEntry & ChainLink = {
      ...e1,
      prevHash: null,
      rowHash: computeRowHash(null, e1),
    };
    const e2 = entry({ id: "2", action: "grade.released" });
    const link2: ChainableEntry & ChainLink = {
      ...e2,
      prevHash: link1.rowHash,
      rowHash: computeRowHash(link1.rowHash, e2),
    };
    expect(verifyChain([link1, link2])).toMatchObject({ ok: true, checked: 2 });

    // Tamper with row 2's action without updating its stored hash.
    const tampered = { ...link2, action: "grade.deleted" };
    const res = verifyChain([link1, tampered]);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe("2");
    expect(res.reason).toBe("hash_mismatch");
  });

  it("verifyChain flags a broken link (reordering/removal)", () => {
    const e1 = entry({ id: "1" });
    const h1 = computeRowHash(null, e1);
    const e2 = entry({ id: "2" });
    // e2 claims to follow h1, but we present it first (no predecessor).
    const orphan = { ...e2, prevHash: h1, rowHash: computeRowHash(h1, e2) };
    const res = verifyChain([orphan]);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("broken_link");
  });
});

describe("audit service", () => {
  it("health reports ok", async () => {
    const res = await buildTestApp().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "audit", status: "ok" });
  });

  it("requires a tenant and an action", async () => {
    const app = buildTestApp();
    expect(
      (await app.inject({ method: "POST", url: "/audit/events", payload: {} }))
        .statusCode,
    ).toBe(400); // no tenant
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/audit/events",
          headers: H,
          payload: { metadata: {} },
        })
      ).statusCode,
    ).toBe(400); // no action
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/audit/events",
          headers: H,
          payload: { action: "x", metadata: [1, 2] },
        })
      ).statusCode,
    ).toBe(400); // metadata not an object
  });

  it("appends a chain, lists newest-first, and verifies intact", async () => {
    const app = buildTestApp();
    for (const action of ["user.login", "grade.released", "role.assigned"]) {
      const res = await app.inject({
        method: "POST",
        url: "/audit/events",
        headers: H,
        payload: { action, actorId: "11111111-1111-1111-1111-111111111111" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().entry.rowHash).toMatch(/^[0-9a-f]{64}$/);
    }
    const first = await app.inject({
      method: "GET",
      url: "/audit/events",
      headers: H,
    });
    const entries = first.json().entries;
    expect(entries).toHaveLength(3);
    expect(entries[0].action).toBe("role.assigned"); // newest first
    expect(entries[0].prevHash).toBe(entries[1].rowHash); // linked

    const verify = await app.inject({
      method: "GET",
      url: "/audit/verify",
      headers: H,
    });
    expect(verify.json().result).toMatchObject({ ok: true, checked: 3 });
  });

  it("verification detects tampering with a stored entry", async () => {
    const store = new MemoryAuditStore();
    const app = buildTestApp(store);
    const ids: string[] = [];
    for (const action of ["a", "b", "c"]) {
      const res = await app.inject({
        method: "POST",
        url: "/audit/events",
        headers: H,
        payload: { action },
      });
      ids.push(res.json().entry.id);
    }
    // Someone edits the middle row's action directly in storage.
    store.tamperForTest(ids[1]!, { action: "tampered" });

    const verify = await app.inject({
      method: "GET",
      url: "/audit/verify",
      headers: H,
    });
    expect(verify.json().result.ok).toBe(false);
    expect(verify.json().result.brokenAt).toBe(ids[1]);
  });

  it("isolates chains per tenant", async () => {
    const app = buildTestApp();
    await app.inject({
      method: "POST",
      url: "/audit/events",
      headers: H,
      payload: { action: "a" },
    });
    const other = await app.inject({
      method: "GET",
      url: "/audit/events",
      headers: OTHER_H,
    });
    expect(other.json().entries).toHaveLength(0);
    // The other tenant's empty chain still verifies ok.
    const verify = await app.inject({
      method: "GET",
      url: "/audit/verify",
      headers: OTHER_H,
    });
    expect(verify.json().result).toMatchObject({ ok: true, checked: 0 });
  });
});
