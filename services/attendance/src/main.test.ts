import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryAttendanceStore,
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

function buildTestApp(store = createSeededMemoryStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

async function openSession(
  app: ReturnType<typeof buildTestApp>,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/sessions",
    headers: HEADERS,
    payload: {
      orgUnitId: "section-a",
      meetingDate: "2026-01-15",
      periodLabel: "Period 1",
      ...overrides,
    },
  });
}

describe("attendance service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "attendance", status: "ok" });
  });
});

describe("attendance codes", () => {
  it("seeds default codes and lists them tenant-scoped", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/codes",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const { codes } = res.json() as { codes: { code: string }[] };
    expect(codes.map((c) => c.code).sort()).toEqual(["A", "EX", "P", "T"]);

    const other = await app.inject({
      method: "GET",
      url: "/codes",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect((other.json() as { codes: unknown[] }).codes).toEqual([]);
  });

  it("creates a custom code (201)", async () => {
    const app = buildTestApp(new MemoryAttendanceStore());
    const res = await app.inject({
      method: "POST",
      url: "/codes",
      headers: HEADERS,
      payload: { code: "RL", label: "Remote Learning", category: "present" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: { code: "RL" } });
  });

  it("rejects an invalid category (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/codes",
      headers: HEADERS,
      payload: { code: "X", label: "Bad", category: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("attendance sessions and records", () => {
  it("opens a session (201) and rejects a duplicate (409)", async () => {
    const app = buildTestApp();
    const first = await openSession(app);
    expect(first.statusCode).toBe(201);
    const dup = await openSession(app);
    expect(dup.statusCode).toBe(409);
  });

  it("marks records, then locks them after finalize", async () => {
    const app = buildTestApp();
    const opened = await openSession(app);
    const { session } = opened.json() as { session: { id: string } };

    const marked = await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/records`,
      headers: HEADERS,
      payload: {
        records: [
          { userId: "stu-1", code: "P" },
          { userId: "stu-2", code: "A" },
        ],
      },
    });
    expect(marked.statusCode).toBe(200);
    expect((marked.json() as { records: unknown[] }).records).toHaveLength(2);

    const finalized = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/finalize`,
      headers: HEADERS,
    });
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json()).toMatchObject({
      session: { status: "finalized" },
    });

    const afterLock = await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/records`,
      headers: HEADERS,
      payload: { records: [{ userId: "stu-1", code: "T" }] },
    });
    expect(afterLock.statusCode).toBe(409);
  });

  it("rejects records with an unknown code (400)", async () => {
    const app = buildTestApp();
    const opened = await openSession(app);
    const { session } = opened.json() as { session: { id: string } };
    const res = await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/records`,
      headers: HEADERS,
      payload: { records: [{ userId: "stu-1", code: "ZZZ" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 finalizing a missing session", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/sessions/missing/finalize",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("attendance summaries and history", () => {
  it("computes per-student rates and flags chronic absence", async () => {
    const app = buildTestApp();
    for (const date of ["2026-02-01", "2026-02-02"]) {
      const opened = await openSession(app, {
        meetingDate: date,
        periodLabel: "Period 1",
      });
      const { session } = opened.json() as { session: { id: string } };
      await app.inject({
        method: "PUT",
        url: `/sessions/${session.id}/records`,
        headers: HEADERS,
        payload: {
          records: [
            { userId: "stu-1", code: "P" },
            { userId: "stu-2", code: "A" },
          ],
        },
      });
    }

    const summary = await app.inject({
      method: "GET",
      url: "/sections/section-a/attendance/summary?threshold=0.5",
      headers: HEADERS,
    });
    expect(summary.statusCode).toBe(200);
    const { students } = (
      summary.json() as {
        summary: { students: Array<Record<string, unknown>> };
      }
    ).summary;
    const stu2 = students.find((s) => s.userId === "stu-2")!;
    expect(stu2).toMatchObject({ absent: 2, total: 2, chronicAbsence: true });
    const stu1 = students.find((s) => s.userId === "stu-1")!;
    expect(stu1).toMatchObject({ present: 2, chronicAbsence: false });
  });

  it("returns a student's attendance history", async () => {
    const app = buildTestApp();
    const opened = await openSession(app);
    const { session } = opened.json() as { session: { id: string } };
    await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/records`,
      headers: HEADERS,
      payload: { records: [{ userId: "stu-9", code: "P" }] },
    });

    const res = await app.inject({
      method: "GET",
      url: "/users/stu-9/attendance",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const { history } = res.json() as {
      history: Array<{ code: string; category: string }>;
    };
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ code: "P", category: "present" });
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/codes" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
