import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemoryRbacStore } from "./rbac.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  JWT_SECRET: "test-secret-at-least-16-chars",
  JWT_AUDIENCE: "lms-api",
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

function build(rbacStore = new MemoryRbacStore()) {
  const app = buildApp({ config, rbacStore, resolveTenant });
  return { app, rbacStore };
}

const H = { "x-tenant-id": DEMO_TENANT_ID };
const OTHER_H = { "x-tenant-id": OTHER_TENANT.tenantId };

async function createRole(app: ReturnType<typeof build>["app"], name: string) {
  return app.inject({ method: "POST", url: "/roles", headers: H, payload: { name } });
}

describe("RBAC: permissions catalog", () => {
  it("lists the permission catalog", async () => {
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/permissions", headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().permissions.length).toBeGreaterThan(0);
    expect(res.json().permissions[0]).toHaveProperty("key");
  });

  it("requires a tenant", async () => {
    const { app } = build();
    expect((await app.inject({ method: "GET", url: "/roles" })).statusCode).toBe(400);
  });
});

describe("RBAC: role CRUD (#19)", () => {
  it("creates a custom role and rejects a duplicate name", async () => {
    const { app } = build();
    const res = await createRole(app, "Dept Head");
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toMatchObject({ name: "Dept Head", isSystem: false });
    expect((await createRole(app, "Dept Head")).statusCode).toBe(409);
  });

  it("requires a name", async () => {
    const { app } = build();
    expect(
      (await app.inject({ method: "POST", url: "/roles", headers: H, payload: {} }))
        .statusCode,
    ).toBe(400);
  });

  it("lists, fetches, renames and deletes a custom role", async () => {
    const { app } = build();
    const id = (await createRole(app, "Mentor")).json().role.id;

    expect((await app.inject({ method: "GET", url: "/roles", headers: H })).json().roles)
      .toHaveLength(1);

    const got = await app.inject({ method: "GET", url: `/roles/${id}`, headers: H });
    expect(got.json().role).toMatchObject({ name: "Mentor", permissions: [] });

    const renamed = await app.inject({
      method: "PATCH",
      url: `/roles/${id}`,
      headers: H,
      payload: { name: "Lead Mentor" },
    });
    expect(renamed.json().role.name).toBe("Lead Mentor");

    expect(
      (await app.inject({ method: "DELETE", url: `/roles/${id}`, headers: H }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: `/roles/${id}`, headers: H }))
        .statusCode,
    ).toBe(404);
  });

  it("treats system roles as read-only", async () => {
    const store = new MemoryRbacStore();
    store.seedRole(
      { id: "sys-1", tenantId: DEMO_TENANT_ID, name: "org_admin", isSystem: true },
      ["users:manage"],
    );
    const { app } = build(store);

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/roles/sys-1",
          headers: H,
          payload: { name: "hacked" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "DELETE", url: "/roles/sys-1", headers: H }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/roles/sys-1/permissions",
          headers: H,
          payload: { permissions: ["users:manage"] },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("RBAC: permission sets", () => {
  it("sets a role's permissions and rejects unknown keys", async () => {
    const { app } = build();
    const id = (await createRole(app, "Grader")).json().role.id;

    const ok = await app.inject({
      method: "PUT",
      url: `/roles/${id}/permissions`,
      headers: H,
      payload: { permissions: ["grades:manage", "reports:view"] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role.permissions).toEqual(["grades:manage", "reports:view"]);

    const bad = await app.inject({
      method: "PUT",
      url: `/roles/${id}/permissions`,
      headers: H,
      payload: { permissions: ["nope:nope"] },
    });
    expect(bad.statusCode).toBe(400);

    const notArray = await app.inject({
      method: "PUT",
      url: `/roles/${id}/permissions`,
      headers: H,
      payload: { permissions: "grades:manage" },
    });
    expect(notArray.statusCode).toBe(400);
  });
});

describe("RBAC: auditing & isolation", () => {
  it("emits an auditable event for each mutation", async () => {
    const { app, rbacStore } = build();
    const id = (await createRole(app, "Auditor")).json().role.id;
    await app.inject({
      method: "PATCH",
      url: `/roles/${id}`,
      headers: H,
      payload: { name: "Senior Auditor" },
    });
    const types = rbacStore.emittedEvents().map((e) => e.type);
    expect(types).toContain("role.created");
    expect(types).toContain("role.updated");
  });

  it("never returns another tenant's roles", async () => {
    const { app } = build();
    await createRole(app, "Tenant A Role");
    const other = await app.inject({ method: "GET", url: "/roles", headers: OTHER_H });
    expect(other.json().roles).toHaveLength(0);
  });
});
