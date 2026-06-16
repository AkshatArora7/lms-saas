import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemoryUserOrgStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const OTHER_TENANT: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER_TENANT.tenantId ? OTHER_TENANT : TENANT;
}

function buildTestApp(store = new MemoryUserOrgStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };
const OTHER_HEADERS = { "x-tenant-id": OTHER_TENANT.tenantId };

async function createOrgUnit(
  app: ReturnType<typeof buildTestApp>,
  payload: Record<string, unknown>,
  headers = HEADERS,
) {
  return app.inject({ method: "POST", url: "/org-units", headers, payload });
}

async function createUser(
  app: ReturnType<typeof buildTestApp>,
  payload: Record<string, unknown>,
  headers = HEADERS,
) {
  return app.inject({ method: "POST", url: "/users", headers, payload });
}

describe("user-org service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "user-org", status: "ok" });
  });
});

describe("tenant resolution", () => {
  it("400s when x-tenant-id is missing", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/org-units" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });
});

describe("org-unit tree (story #22)", () => {
  it("creates a root org unit and a child with the right path", async () => {
    const app = buildTestApp();
    const root = await createOrgUnit(app, {
      type: "organization",
      name: "District",
    });
    expect(root.statusCode).toBe(201);
    const rootId = root.json().orgUnit.id;
    expect(root.json().orgUnit.path).toEqual([]);
    expect(root.json().orgUnit.parentId).toBeNull();

    const child = await createOrgUnit(app, {
      type: "department",
      name: "Science",
      parentId: rootId,
    });
    expect(child.statusCode).toBe(201);
    expect(child.json().orgUnit.path).toEqual([rootId]);

    const section = await createOrgUnit(app, {
      type: "section",
      name: "Bio 101 - A",
      parentId: child.json().orgUnit.id,
    });
    expect(section.json().orgUnit.path).toEqual([
      rootId,
      child.json().orgUnit.id,
    ]);
  });

  it("rejects an invalid type and an unknown parent", async () => {
    const app = buildTestApp();
    const badType = await createOrgUnit(app, { type: "galaxy", name: "X" });
    expect(badType.statusCode).toBe(400);

    const orphan = await createOrgUnit(app, {
      type: "section",
      name: "X",
      parentId: "99999999-9999-9999-9999-999999999999",
    });
    expect(orphan.statusCode).toBe(400);
  });

  it("requires a name", async () => {
    const app = buildTestApp();
    const res = await createOrgUnit(app, { type: "organization" });
    expect(res.statusCode).toBe(400);
  });

  it("lists, filters, and fetches org units; 404s for missing", async () => {
    const app = buildTestApp();
    const org = (await createOrgUnit(app, { type: "organization", name: "D" }))
      .json()
      .orgUnit.id;
    await createOrgUnit(app, { type: "department", name: "Math", parentId: org });
    await createOrgUnit(app, { type: "department", name: "Art", parentId: org });

    const all = await app.inject({ method: "GET", url: "/org-units", headers: HEADERS });
    expect(all.json().orgUnits).toHaveLength(3);

    const depts = await app.inject({
      method: "GET",
      url: "/org-units?type=department",
      headers: HEADERS,
    });
    expect(depts.json().orgUnits).toHaveLength(2);

    const children = await app.inject({
      method: "GET",
      url: `/org-units?parentId=${org}`,
      headers: HEADERS,
    });
    expect(children.json().orgUnits).toHaveLength(2);

    const missing = await app.inject({
      method: "GET",
      url: "/org-units/99999999-9999-9999-9999-999999999999",
      headers: HEADERS,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("returns subtree descendants and ancestors", async () => {
    const app = buildTestApp();
    const org = (await createOrgUnit(app, { type: "organization", name: "D" }))
      .json()
      .orgUnit.id;
    const dept = (
      await createOrgUnit(app, { type: "department", name: "Math", parentId: org })
    )
      .json()
      .orgUnit.id;
    const section = (
      await createOrgUnit(app, { type: "section", name: "Alg-A", parentId: dept })
    )
      .json()
      .orgUnit.id;

    const subtree = await app.inject({
      method: "GET",
      url: `/org-units/${org}/subtree`,
      headers: HEADERS,
    });
    const subtreeIds = subtree
      .json()
      .orgUnits.map((o: { id: string }) => o.id);
    expect(subtreeIds).toContain(dept);
    expect(subtreeIds).toContain(section);
    expect(subtreeIds).not.toContain(org); // descendants only

    const ancestors = await app.inject({
      method: "GET",
      url: `/org-units/${section}/ancestors`,
      headers: HEADERS,
    });
    expect(ancestors.json().orgUnits.map((o: { id: string }) => o.id)).toEqual([
      org,
      dept,
    ]);
  });

  it("patches name and active state", async () => {
    const app = buildTestApp();
    const id = (await createOrgUnit(app, { type: "organization", name: "Old" }))
      .json()
      .orgUnit.id;
    const res = await app.inject({
      method: "PATCH",
      url: `/org-units/${id}`,
      headers: HEADERS,
      payload: { name: "New", isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orgUnit).toMatchObject({ name: "New", isActive: false });
  });
});

describe("users & roles (story #23)", () => {
  it("creates a user, rejects a duplicate email, and fetches the profile", async () => {
    const app = buildTestApp();
    const created = await createUser(app, {
      email: "Teacher@demo.school",
      displayName: "Pat Lee",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user.status).toBe("invited");
    const userId = created.json().user.id;

    const dup = await createUser(app, {
      email: "teacher@demo.school", // case-insensitive collision
      displayName: "Other",
    });
    expect(dup.statusCode).toBe(409);

    const profile = await app.inject({
      method: "GET",
      url: `/users/${userId}`,
      headers: HEADERS,
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().user.memberships).toEqual([]);
  });

  it("validates required fields", async () => {
    const app = buildTestApp();
    expect((await createUser(app, { displayName: "X" })).statusCode).toBe(400);
    expect((await createUser(app, { email: "a@b.c" })).statusCode).toBe(400);
  });

  it("assigns a role at an org unit and reflects it in the profile", async () => {
    const app = buildTestApp();
    const org = (await createOrgUnit(app, { type: "organization", name: "D" }))
      .json()
      .orgUnit.id;
    const userId = (
      await createUser(app, { email: "t@demo.school", displayName: "T" })
    )
      .json()
      .user.id;

    const assign = await app.inject({
      method: "POST",
      url: `/users/${userId}/roles`,
      headers: HEADERS,
      payload: { role: "instructor", orgUnitId: org },
    });
    expect(assign.statusCode).toBe(201);
    expect(assign.json().membership).toMatchObject({
      roleName: "instructor",
      orgUnitId: org,
      cascade: true,
    });
    const assignmentId = assign.json().membership.assignmentId;

    const profile = await app.inject({
      method: "GET",
      url: `/users/${userId}`,
      headers: HEADERS,
    });
    expect(profile.json().user.memberships).toHaveLength(1);

    // List users by org unit returns the assigned user.
    const byOrg = await app.inject({
      method: "GET",
      url: `/users?orgUnitId=${org}`,
      headers: HEADERS,
    });
    expect(byOrg.json().users).toHaveLength(1);

    // Revoke.
    const revoke = await app.inject({
      method: "DELETE",
      url: `/users/${userId}/roles/${assignmentId}`,
      headers: HEADERS,
    });
    expect(revoke.statusCode).toBe(204);
    const revokeMissing = await app.inject({
      method: "DELETE",
      url: `/users/${userId}/roles/${assignmentId}`,
      headers: HEADERS,
    });
    expect(revokeMissing.statusCode).toBe(404);
  });

  it("rejects unknown role (400), unknown org unit (400), missing user (404)", async () => {
    const app = buildTestApp();
    const org = (await createOrgUnit(app, { type: "organization", name: "D" }))
      .json()
      .orgUnit.id;
    const userId = (
      await createUser(app, { email: "t@demo.school", displayName: "T" })
    )
      .json()
      .user.id;

    const unknownRole = await app.inject({
      method: "POST",
      url: `/users/${userId}/roles`,
      headers: HEADERS,
      payload: { role: "wizard", orgUnitId: org },
    });
    expect(unknownRole.statusCode).toBe(400);

    const unknownOrg = await app.inject({
      method: "POST",
      url: `/users/${userId}/roles`,
      headers: HEADERS,
      payload: { role: "instructor", orgUnitId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(unknownOrg.statusCode).toBe(400);

    const missingUser = await app.inject({
      method: "POST",
      url: `/users/00000000-0000-0000-0000-000000000000/roles`,
      headers: HEADERS,
      payload: { role: "instructor", orgUnitId: org },
    });
    expect(missingUser.statusCode).toBe(404);
  });

  it("updates a user and supports the inactive transition", async () => {
    const app = buildTestApp();
    const userId = (
      await createUser(app, { email: "t@demo.school", displayName: "T" })
    )
      .json()
      .user.id;
    const res = await app.inject({
      method: "PATCH",
      url: `/users/${userId}`,
      headers: HEADERS,
      payload: { displayName: "Tina", status: "inactive" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      displayName: "Tina",
      status: "inactive",
    });

    const bad = await app.inject({
      method: "PATCH",
      url: `/users/${userId}`,
      headers: HEADERS,
      payload: { status: "ghost" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("never returns another tenant's org units or users", async () => {
    const store = new MemoryUserOrgStore();
    const app = buildTestApp(store);

    const org = (await createOrgUnit(app, { type: "organization", name: "A-Org" }))
      .json()
      .orgUnit.id;
    await createUser(app, { email: "a@demo.school", displayName: "A" });

    // Other tenant sees nothing.
    const otherOrgs = await app.inject({
      method: "GET",
      url: "/org-units",
      headers: OTHER_HEADERS,
    });
    expect(otherOrgs.json().orgUnits).toHaveLength(0);

    const otherUsers = await app.inject({
      method: "GET",
      url: "/users",
      headers: OTHER_HEADERS,
    });
    expect(otherUsers.json().users).toHaveLength(0);

    // Other tenant cannot fetch this tenant's org unit by id.
    const crossFetch = await app.inject({
      method: "GET",
      url: `/org-units/${org}`,
      headers: OTHER_HEADERS,
    });
    expect(crossFetch.statusCode).toBe(404);
  });
});
