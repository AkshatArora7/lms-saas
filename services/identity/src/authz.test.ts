import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import {
  checkAccess,
  effectivePermissions,
  isGrantApplicable,
  type Grant,
} from "./authz.js";
import { MemoryAuthzStore } from "./authz.memory.js";
import { buildApp } from "./main.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  JWT_SECRET: "test-secret-at-least-16-chars-long",
  JWT_AUDIENCE: "lms-api",
} as unknown as AppConfig;

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "44444444-4444-4444-4444-444444444444";

// District -> School -> Course -> Section
const DISTRICT = "d0000000-0000-0000-0000-000000000000";
const SCHOOL = "50000000-0000-0000-0000-000000000000";
const COURSE = "c0000000-0000-0000-0000-000000000000";
const SECTION = "5e000000-0000-0000-0000-000000000000";

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    roleId: "role-1",
    roleName: "school_admin",
    permission: "users:manage",
    orgUnitId: SCHOOL,
    cascade: true,
    ...overrides,
  };
}

function build() {
  const store = new MemoryAuthzStore();
  // Ancestor paths (root-first, excluding self), mirroring org_unit.path.
  store.seedOrgUnit(TENANT, DISTRICT, []);
  store.seedOrgUnit(TENANT, SCHOOL, [DISTRICT]);
  store.seedOrgUnit(TENANT, COURSE, [DISTRICT, SCHOOL]);
  store.seedOrgUnit(TENANT, SECTION, [DISTRICT, SCHOOL, COURSE]);
  return { app: buildApp({ config, authzStore: store, resolveTenant }), store };
}

const H = { "x-tenant-id": TENANT };

describe("authz policy (pure)", () => {
  const target = { id: SECTION, path: [DISTRICT, SCHOOL, COURSE] };
  it("applies a cascading ancestor grant to a descendant", () => {
    expect(isGrantApplicable(grant({ orgUnitId: SCHOOL, cascade: true }), target)).toBe(true);
  });
  it("does NOT apply a non-cascading ancestor grant", () => {
    expect(isGrantApplicable(grant({ orgUnitId: SCHOOL, cascade: false }), target)).toBe(false);
  });
  it("applies a direct grant at the target", () => {
    expect(isGrantApplicable(grant({ orgUnitId: SECTION, cascade: false }), target)).toBe(true);
  });
  it("denies by default and grants only on a matching permission+scope", () => {
    expect(checkAccess([], "users:manage", target).reason).toBe("deny_by_default");
    expect(checkAccess([grant()], "grades:edit", target).allowed).toBe(false); // wrong perm
    expect(checkAccess([grant()], "users:manage", target).allowed).toBe(true);
  });
  it("de-duplicates effective permissions", () => {
    const list = effectivePermissions([grant(), grant(), grant({ permission: "grades:edit" })]);
    expect(list).toHaveLength(2);
  });
});

describe("org-scoped RBAC surface (#18)", () => {
  it("health reports ok", async () => {
    const res = await build().app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("identity");
  });

  it("cascades a school-scoped grant down to a section (subtree)", async () => {
    const { app, store } = build();
    store.seedGrant(TENANT, USER, grant({ orgUnitId: SCHOOL, cascade: true }));
    const res = await app.inject({
      method: "GET",
      url: `/authz/check?userId=${USER}&permission=users:manage&orgUnitId=${SECTION}`,
      headers: H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toMatchObject({ allowed: true, reason: "granted" });
  });

  it("does not cascade when the assignment has cascade=false", async () => {
    const { app, store } = build();
    store.seedGrant(TENANT, USER, grant({ orgUnitId: SCHOOL, cascade: false }));
    const atSection = await app.inject({
      method: "GET",
      url: `/authz/check?userId=${USER}&permission=users:manage&orgUnitId=${SECTION}`,
      headers: H,
    });
    expect(atSection.json().decision.allowed).toBe(false);
    // ...but it still holds at the school itself.
    const atSchool = await app.inject({
      method: "GET",
      url: `/authz/check?userId=${USER}&permission=users:manage&orgUnitId=${SCHOOL}`,
      headers: H,
    });
    expect(atSchool.json().decision.allowed).toBe(true);
  });

  it("is deny-by-default with no grant and isolates tenants", async () => {
    const { app, store } = build();
    // Grant exists in a DIFFERENT tenant only.
    store.seedGrant("22222222-2222-2222-2222-222222222222", USER, grant());
    const res = await app.inject({
      method: "GET",
      url: `/authz/check?userId=${USER}&permission=users:manage&orgUnitId=${SCHOOL}`,
      headers: H,
    });
    expect(res.json().decision).toMatchObject({ allowed: false, reason: "deny_by_default" });
  });

  it("404s an unknown org unit and 400s missing params", async () => {
    const { app } = build();
    expect(
      (await app.inject({ method: "GET", url: `/authz/check?userId=${USER}&permission=p&orgUnitId=99999999-9999-9999-9999-999999999999`, headers: H })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `/authz/check?permission=p&orgUnitId=${SCHOOL}`, headers: H })).statusCode,
    ).toBe(400);
  });

  it("lists effective permissions for debugging", async () => {
    const { app, store } = build();
    store.seedGrant(TENANT, USER, grant({ orgUnitId: SCHOOL, permission: "users:manage" }));
    store.seedGrant(TENANT, USER, grant({ orgUnitId: COURSE, permission: "grades:edit", roleName: "teacher" }));
    const res = await app.inject({
      method: "GET",
      url: `/users/${USER}/effective-permissions`,
      headers: H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().permissions).toHaveLength(2);
    expect(res.json().permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ permission: "users:manage", orgUnitId: SCHOOL }),
        expect.objectContaining({ permission: "grades:edit", orgUnitId: COURSE, roleName: "teacher" }),
      ]),
    );
  });
});
