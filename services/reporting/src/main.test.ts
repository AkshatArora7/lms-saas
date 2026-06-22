import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { FakeReportRunner } from "./runner.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
} from "./store.memory.js";
import {
  BUILTIN_DEFINITIONS,
  isBuiltinDefinitionKey,
  type ReportRun,
} from "./store.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT_A: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const TENANT_B: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === TENANT_B.tenantId ? TENANT_B : TENANT_A;
}

const USER_ID = "44444444-4444-4444-4444-444444444444";
const HEADERS_A = { "x-tenant-id": DEMO_TENANT_ID, "x-user-id": USER_ID };
const HEADERS_B = { "x-tenant-id": TENANT_B.tenantId, "x-user-id": USER_ID };

/** Build a test app wired to a memory store + deterministic fake runner. */
function buildTestApp(store = createSeededMemoryStore()) {
  return buildApp({
    config,
    store,
    resolveTenant,
    runner: new FakeReportRunner(),
  });
}

describe("reporting service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "reporting", status: "ok" });
  });
});

describe("pure helpers", () => {
  it("recognizes the built-in definition keys", () => {
    expect(isBuiltinDefinitionKey("enrollment-summary")).toBe(true);
    expect(isBuiltinDefinitionKey("course-completion-summary")).toBe(true);
    expect(isBuiltinDefinitionKey("nope")).toBe(false);
  });
});

describe("definitions", () => {
  it("returns the two seeded built-ins for the caller tenant", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/definitions",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    const { definitions } = res.json() as {
      definitions: { key: string }[];
    };
    expect(definitions).toHaveLength(BUILTIN_DEFINITIONS.length);
    const keys = definitions.map((d) => d.key).sort();
    expect(keys).toEqual(["course-completion-summary", "enrollment-summary"]);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/definitions" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});

describe("runs", () => {
  it("creates + executes a run, persisting succeeded + result + row_count", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: HEADERS_A,
      payload: { definitionKey: "enrollment-summary" },
    });
    expect(res.statusCode).toBe(201);
    const { run } = res.json() as { run: ReportRun };
    expect(run.status).toBe("succeeded");
    expect(run.definitionKey).toBe("enrollment-summary");
    expect(run.requestedBy).toBe(USER_ID);
    expect(run.rowCount).toBe(2);
    expect(run.completedAt).toBeTruthy();
    expect((run.result as { total: number }).total).toBe(3);
  });

  it("rejects a missing definitionKey (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: HEADERS_A,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("rejects an unknown definitionKey (400, no run persisted)", async () => {
    const store = createSeededMemoryStore();
    const app = buildTestApp(store);
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: HEADERS_A,
      payload: { definitionKey: "does-not-exist" },
    });
    expect(res.statusCode).toBe(400);
    const list = await app.inject({
      method: "GET",
      url: "/runs",
      headers: HEADERS_A,
    });
    expect((list.json() as { runs: ReportRun[] }).runs).toHaveLength(0);
  });

  it("lists the caller-tenant's runs newest-first", async () => {
    const app = buildTestApp();
    await app.inject({
      method: "POST",
      url: "/runs",
      headers: HEADERS_A,
      payload: { definitionKey: "enrollment-summary" },
    });
    await app.inject({
      method: "POST",
      url: "/runs",
      headers: HEADERS_A,
      payload: { definitionKey: "course-completion-summary" },
    });
    const res = await app.inject({
      method: "GET",
      url: "/runs",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    const { runs } = res.json() as { runs: ReportRun[] };
    expect(runs).toHaveLength(2);
    // Newest (the second created) is first.
    expect(runs[0]!.definitionKey).toBe("course-completion-summary");
    expect(runs[1]!.definitionKey).toBe("enrollment-summary");
  });

  it("returns a single run incl. its result by id", async () => {
    const app = buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/runs",
      headers: HEADERS_A,
      payload: { definitionKey: "course-completion-summary" },
    });
    const id = (created.json() as { run: ReportRun }).run.id;
    const res = await app.inject({
      method: "GET",
      url: `/runs/${id}`,
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    const { run } = res.json() as { run: ReportRun };
    expect(run.id).toBe(id);
    expect((run.result as { courses: unknown[] }).courses).toHaveLength(1);
  });

  it("returns 404 for an unknown run id", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/runs/99999999-9999-9999-9999-999999999999",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });
});

describe("tenant isolation", () => {
  it("never returns tenant A's run to tenant B (list empty + get 404)", async () => {
    const store = createSeededMemoryStore();
    const app = buildTestApp(store);
    const created = await app.inject({
      method: "POST",
      url: "/runs",
      headers: HEADERS_A,
      payload: { definitionKey: "enrollment-summary" },
    });
    const id = (created.json() as { run: ReportRun }).run.id;

    const listB = await app.inject({
      method: "GET",
      url: "/runs",
      headers: HEADERS_B,
    });
    expect((listB.json() as { runs: ReportRun[] }).runs).toHaveLength(0);

    const getB = await app.inject({
      method: "GET",
      url: `/runs/${id}`,
      headers: HEADERS_B,
    });
    expect(getB.statusCode).toBe(404);
  });
});
