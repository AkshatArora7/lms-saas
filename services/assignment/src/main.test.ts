import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryAssignmentStore,
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

function buildTestApp(store = new MemoryAssignmentStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

type App = ReturnType<typeof buildTestApp>;

async function createAssignment(
  app: App,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/assignments",
    headers: HEADERS,
    payload: {
      courseId: "course-1",
      title: "Essay 1",
      submissionType: "text",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { assignment: { id: string } }).assignment.id;
}

describe("assignment service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "assignment", status: "ok" });
  });
});

describe("assignments", () => {
  it("creates an assignment (201) and lists it by course", async () => {
    const app = buildTestApp();
    await createAssignment(app);
    const list = await app.inject({
      method: "GET",
      url: "/assignments?courseId=course-1",
      headers: HEADERS,
    });
    expect(list.statusCode).toBe(200);
    expect(
      (list.json() as { assignments: unknown[] }).assignments,
    ).toHaveLength(1);
  });

  it("rejects an assignment without a title (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/assignments",
      headers: HEADERS,
      payload: { courseId: "course-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid submissionType (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/assignments",
      headers: HEADERS,
      payload: { courseId: "c", title: "T", submissionType: "carrier-pigeon" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a missing assignment", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/assignments/missing",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("submissions", () => {
  it("submits (201) and lists the submission for grading", async () => {
    const app = buildTestApp();
    const id = await createAssignment(app, {
      dueAt: "2999-01-01T00:00:00.000Z",
    });
    const sub = await app.inject({
      method: "POST",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
      payload: { userId: "stu-1", body: "My essay." },
    });
    expect(sub.statusCode).toBe(201);
    expect(sub.json()).toMatchObject({
      submission: { status: "submitted", isLate: false },
    });

    const list = await app.inject({
      method: "GET",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
    });
    expect(
      (list.json() as { submissions: unknown[] }).submissions,
    ).toHaveLength(1);
  });

  it("flags a late submission when past due (allowLate=true)", async () => {
    const app = buildTestApp();
    const id = await createAssignment(app, {
      dueAt: "2000-01-01T00:00:00.000Z",
      allowLate: true,
    });
    const sub = await app.inject({
      method: "POST",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
      payload: { userId: "stu-1", body: "Late essay." },
    });
    expect(sub.statusCode).toBe(201);
    expect(sub.json()).toMatchObject({ submission: { isLate: true } });
  });

  it("rejects a late submission when allowLate=false (409)", async () => {
    const app = buildTestApp();
    const id = await createAssignment(app, {
      dueAt: "2000-01-01T00:00:00.000Z",
      allowLate: false,
    });
    const sub = await app.inject({
      method: "POST",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
      payload: { userId: "stu-1", body: "Too late." },
    });
    expect(sub.statusCode).toBe(409);
    expect(sub.json()).toMatchObject({ error: "late_not_allowed" });
  });

  it("resubmits (200) keeping a single submission per user", async () => {
    const app = buildTestApp();
    const id = await createAssignment(app, {
      dueAt: "2999-01-01T00:00:00.000Z",
    });
    await app.inject({
      method: "POST",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
      payload: { userId: "stu-1", body: "v1" },
    });
    const again = await app.inject({
      method: "POST",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
      payload: { userId: "stu-1", body: "v2" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      submission: { status: "resubmitted", body: "v2" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
    });
    expect(
      (list.json() as { submissions: unknown[] }).submissions,
    ).toHaveLength(1);
  });

  it("returns a submission (status -> returned)", async () => {
    const app = buildTestApp();
    const id = await createAssignment(app);
    const sub = await app.inject({
      method: "POST",
      url: `/assignments/${id}/submissions`,
      headers: HEADERS,
      payload: { userId: "stu-1", body: "x" },
    });
    const submissionId = (sub.json() as { submission: { id: string } })
      .submission.id;
    const returned = await app.inject({
      method: "POST",
      url: `/submissions/${submissionId}/return`,
      headers: HEADERS,
    });
    expect(returned.statusCode).toBe(200);
    expect(returned.json()).toMatchObject({
      submission: { status: "returned" },
    });
  });

  it("404 submitting to a missing assignment", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/assignments/missing/submissions",
      headers: HEADERS,
      payload: { userId: "stu-1" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("tenant isolation", () => {
  it("isolates assignments across tenants", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const ours = await app.inject({
      method: "GET",
      url: "/assignments?courseId=demo-course",
      headers: HEADERS,
    });
    expect(
      (ours.json() as { assignments: unknown[] }).assignments,
    ).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: "/assignments?courseId=demo-course",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect((theirs.json() as { assignments: unknown[] }).assignments).toEqual(
      [],
    );
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/assignments?courseId=course-1",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
