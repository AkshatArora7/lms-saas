import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryCourseStore,
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

function buildTestApp(store = new MemoryCourseStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

describe("course service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "course", status: "ok" });
  });
});

describe("course routes", () => {
  it("lists an empty store", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/courses",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ courses: [] });
  });

  it("lists seeded courses for the demo tenant only", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const res = await app.inject({
      method: "GET",
      url: "/courses",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const { courses } = res.json() as { courses: unknown[] };
    expect(courses).toHaveLength(2);
  });

  it("isolates courses across tenants", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const res = await app.inject({
      method: "GET",
      url: "/courses",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ courses: [] });
  });

  it("creates a course (201) then fetches it", async () => {
    const app = buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/courses",
      headers: HEADERS,
      payload: { title: "Biology 200", description: "Cells and systems." },
    });
    expect(created.statusCode).toBe(201);
    const { course } = created.json() as { course: { id: string } };
    expect(course.id).toBeTruthy();

    const fetched = await app.inject({
      method: "GET",
      url: `/courses/${course.id}`,
      headers: HEADERS,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      course: { title: "Biology 200", isPublished: false },
    });
  });

  it("rejects a course without a title (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/courses",
      headers: HEADERS,
      payload: { description: "no title" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("publishes a course (flips isPublished)", async () => {
    const app = buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/courses",
      headers: HEADERS,
      payload: { title: "Chemistry 101" },
    });
    const { course } = created.json() as { course: { id: string } };

    const published = await app.inject({
      method: "POST",
      url: `/courses/${course.id}/publish`,
      headers: HEADERS,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      course: { id: course.id, isPublished: true },
    });
  });

  it("returns 404 for a missing course", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/courses/does-not-exist",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when publishing a missing course", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/courses/does-not-exist/publish",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/courses" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
