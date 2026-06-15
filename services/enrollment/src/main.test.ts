import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryEnrollmentStore,
} from "./store.memory.js";

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

function buildTestApp(store = new MemoryEnrollmentStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

async function enroll(
  app: ReturnType<typeof buildTestApp>,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/enrollments",
    headers: HEADERS,
    payload: {
      userId: "stu-1",
      orgUnitId: "section-a",
      role: "learner",
      ...overrides,
    },
  });
}

describe("enrollment service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "enrollment", status: "ok" });
  });
});

describe("enrollments", () => {
  it("enrolls a user (201) and lists them in the roster", async () => {
    const app = buildTestApp();
    const created = await enroll(app);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      enrollment: { role: "learner", status: "active" },
    });

    const roster = await app.inject({
      method: "GET",
      url: "/sections/section-a/roster",
      headers: HEADERS,
    });
    expect(roster.statusCode).toBe(200);
    expect((roster.json() as { roster: unknown[] }).roster).toHaveLength(1);
  });

  it("rejects an unknown role (400)", async () => {
    const app = buildTestApp();
    const res = await enroll(app, { role: "wizard" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a duplicate enrollment (409)", async () => {
    const app = buildTestApp();
    await enroll(app);
    const dup = await enroll(app);
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "already_enrolled" });
  });

  it("drops an enrollment, removing it from the active roster", async () => {
    const app = buildTestApp();
    const created = await enroll(app);
    const { enrollment } = created.json() as { enrollment: { id: string } };

    const dropped = await app.inject({
      method: "DELETE",
      url: `/enrollments/${enrollment.id}`,
      headers: HEADERS,
    });
    expect(dropped.statusCode).toBe(200);
    expect(dropped.json()).toMatchObject({
      enrollment: { status: "withdrawn" },
    });

    const roster = await app.inject({
      method: "GET",
      url: "/sections/section-a/roster",
      headers: HEADERS,
    });
    expect((roster.json() as { roster: unknown[] }).roster).toEqual([]);
  });

  it("completes an enrollment", async () => {
    const app = buildTestApp();
    const created = await enroll(app);
    const { enrollment } = created.json() as { enrollment: { id: string } };
    const completed = await app.inject({
      method: "POST",
      url: `/enrollments/${enrollment.id}/complete`,
      headers: HEADERS,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      enrollment: { status: "completed" },
    });
  });

  it("lists a user's enrollments across sections", async () => {
    const app = buildTestApp();
    await enroll(app, { orgUnitId: "section-a" });
    await enroll(app, { orgUnitId: "section-b", role: "teaching_assistant" });
    const res = await app.inject({
      method: "GET",
      url: "/users/stu-1/enrollments",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(
      (res.json() as { enrollments: unknown[] }).enrollments,
    ).toHaveLength(2);
  });

  it("isolates rosters across tenants", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const ours = await app.inject({
      method: "GET",
      url: "/sections/demo-section/roster",
      headers: HEADERS,
    });
    expect((ours.json() as { roster: unknown[] }).roster).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: "/sections/demo-section/roster",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect((theirs.json() as { roster: unknown[] }).roster).toEqual([]);
  });

  it("returns 404 for a missing enrollment", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/enrollments/missing",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it("updates an enrollment's role", async () => {
    const app = buildTestApp();
    const created = await enroll(app);
    const { enrollment } = created.json() as { enrollment: { id: string } };

    const updated = await app.inject({
      method: "PATCH",
      url: `/enrollments/${enrollment.id}`,
      headers: HEADERS,
      payload: { role: "teaching_assistant" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      enrollment: { role: "teaching_assistant", status: "active" },
    });
  });

  it("rejects a role update to an unknown role (400)", async () => {
    const app = buildTestApp();
    const created = await enroll(app);
    const { enrollment } = created.json() as { enrollment: { id: string } };
    const res = await app.inject({
      method: "PATCH",
      url: `/enrollments/${enrollment.id}`,
      headers: HEADERS,
      payload: { role: "wizard" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when updating a missing enrollment's role", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/enrollments/missing",
      headers: HEADERS,
      payload: { role: "learner" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/sections/section-a/roster",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
