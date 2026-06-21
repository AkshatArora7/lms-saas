import type { AppConfig } from "@lms/config";
import { EVENT_TYPES } from "@lms/events";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemoryAnalyticsStore } from "./store.memory.js";
import {
  aggregateEvents,
  buildOrgUnitRollups,
  ratePct,
  round1,
  summarizeOrgUnitRollups,
} from "./store.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT = DEMO_TENANT_ID;
const OTHER = "22222222-2222-2222-2222-222222222222";

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

function build(store = new MemoryAnalyticsStore()) {
  return { app: buildApp({ config, store, resolveTenant }), store };
}

const H = { "x-tenant-id": TENANT };
const OTHER_H = { "x-tenant-id": OTHER };

function caliper(extra: Record<string, unknown> = {}) {
  return {
    type: "AssessmentEvent",
    action: "Submitted",
    objectType: "Assessment",
    objectId: "quiz-1",
    ...extra,
  };
}

async function post(app: ReturnType<typeof build>["app"], url: string, payload: unknown, headers = H) {
  return app.inject({ method: "POST", url, headers, payload });
}

describe("aggregation (pure)", () => {
  it("counts by dimension, ordered by count desc then key", () => {
    const agg = aggregateEvents(
      [
        { type: "A", action: "Submitted", objectType: "X" },
        { type: "B", action: "Viewed", objectType: "X" },
        { type: "A", action: "Viewed", objectType: "X" },
        { type: "A", action: "Submitted", objectType: "X" },
      ],
      "type",
    );
    expect(agg.total).toBe(4);
    expect(agg.buckets).toEqual([
      { key: "A", count: 3 },
      { key: "B", count: 1 },
    ]);
  });
});

describe("analytics LRS (#60)", () => {
  it("health reports ok", async () => {
    const res = await build().app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("analytics");
  });

  it("ingests a Caliper event and writes a transactional outbox row", async () => {
    const { app, store } = build();
    const res = await post(app, "/analytics/events", caliper({ actorId: "u1" }));
    expect(res.statusCode).toBe(201);
    expect(res.json().event).toMatchObject({
      type: "AssessmentEvent",
      action: "Submitted",
      actorId: "u1",
    });
    // Outbox row emitted in the same step (relay -> QStash async delivery).
    const outbox = store.emittedEvents();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      type: EVENT_TYPES.LEARNING_EVENT_CAPTURED,
      tenantId: TENANT,
    });
  });

  it("validates Caliper ingestion input", async () => {
    const { app } = build();
    expect((await post(app, "/analytics/events", { action: "Submitted", objectType: "A", objectId: "1" })).statusCode).toBe(400);
    expect((await post(app, "/analytics/events", caliper({ envelope: "nope" }))).statusCode).toBe(400);
  });

  it("ingests an xAPI statement", async () => {
    const { app } = build();
    const res = await post(app, "/analytics/xapi", {
      verb: "completed",
      objectId: "course/1",
      result: { score: 0.9 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().statement).toMatchObject({ verb: "completed", result: { score: 0.9 } });
    expect((await post(app, "/analytics/xapi", { objectId: "x" })).statusCode).toBe(400);
  });

  it("lists events filtered by type/time and isolates tenants", async () => {
    const { app } = build();
    await post(app, "/analytics/events", caliper({ type: "NavigationEvent", action: "NavigatedTo", eventTime: "2026-01-10T00:00:00.000Z" }));
    await post(app, "/analytics/events", caliper({ eventTime: "2026-03-10T00:00:00.000Z" }));
    // Other tenant event must not leak.
    await post(app, "/analytics/events", caliper(), OTHER_H);

    const mine = await app.inject({ method: "GET", url: "/analytics/events", headers: H });
    expect(mine.json().events).toHaveLength(2);

    const nav = await app.inject({ method: "GET", url: "/analytics/events?type=NavigationEvent", headers: H });
    expect(nav.json().events).toHaveLength(1);

    const other = await app.inject({ method: "GET", url: "/analytics/events", headers: OTHER_H });
    expect(other.json().events).toHaveLength(1);
  });

  it("serves de-identified aggregates (no actor identity)", async () => {
    const { app } = build();
    await post(app, "/analytics/events", caliper({ actorId: "u1", action: "Submitted" }));
    await post(app, "/analytics/events", caliper({ actorId: "u2", action: "Submitted" }));
    await post(app, "/analytics/events", caliper({ actorId: "u3", action: "Viewed" }));

    const res = await app.inject({ method: "GET", url: "/analytics/aggregate?dimension=action", headers: H });
    expect(res.statusCode).toBe(200);
    const agg = res.json().aggregate;
    expect(agg.total).toBe(3);
    expect(agg.buckets).toEqual([
      { key: "Submitted", count: 2 },
      { key: "Viewed", count: 1 },
    ]);
    // De-identified: the payload carries no actor field anywhere.
    expect(JSON.stringify(agg)).not.toContain("u1");

    expect((await app.inject({ method: "GET", url: "/analytics/aggregate?dimension=bogus", headers: H })).statusCode).toBe(400);
  });
});

describe("org-unit reporting rollups (#269)", () => {
  it("buildOrgUnitRollups aggregates a school's subtree (pure)", () => {
    const rollups = buildOrgUnitRollups({
      orgUnits: [
        { id: "s1", name: "Beta School", code: "B", type: "organization", path: [] },
        { id: "s2", name: "Alpha School", code: "A", type: "organization", path: [] },
        { id: "o1", name: "Offering", code: null, type: "course_offering", path: ["s1"] },
      ],
      courses: [{ orgUnitId: "o1" }],
      enrollments: [{ orgUnitId: "o1" }, { orgUnitId: "o1" }],
      attendance: [
        { orgUnitId: "o1", present: true },
        { orgUnitId: "o1", present: false },
        { orgUnitId: "o1", present: true },
      ],
      grades: [{ orgUnitId: "o1", pct: 80 }, { orgUnitId: "o1", pct: 100 }],
    });
    // Sorted by name: Alpha (empty) then Beta (the one with the subtree).
    expect(rollups.map((r) => r.name)).toEqual(["Alpha School", "Beta School"]);
    expect(rollups[1]).toEqual({
      orgUnitId: "s1",
      name: "Beta School",
      code: "B",
      courseCount: 1,
      enrollmentCount: 2,
      attendanceRate: 66.7,
      averageGrade: 90,
    });
    // No data → null rates, not zero.
    expect(rollups[0]).toMatchObject({
      courseCount: 0,
      enrollmentCount: 0,
      attendanceRate: null,
      averageGrade: null,
    });
  });

  it("ratePct/round1 are null-safe and rounded", () => {
    expect(ratePct(2, 3)).toBe(66.7);
    expect(ratePct(0, 0)).toBeNull();
    expect(round1(92.04)).toBe(92);
  });

  it("summarizeOrgUnitRollups enrollment-weights the rates", () => {
    const summary = summarizeOrgUnitRollups([
      { orgUnitId: "a", name: "A", code: null, courseCount: 2, enrollmentCount: 10, attendanceRate: 90, averageGrade: 80 },
      { orgUnitId: "b", name: "B", code: null, courseCount: 1, enrollmentCount: 30, attendanceRate: 50, averageGrade: 60 },
    ]);
    expect(summary.orgUnitCount).toBe(2);
    expect(summary.courseCount).toBe(3);
    expect(summary.enrollmentCount).toBe(40);
    // (90*10 + 50*30) / 40 = 60; (80*10 + 60*30) / 40 = 65.
    expect(summary.attendanceRate).toBe(60);
    expect(summary.averageGrade).toBe(65);
  });

  it("GET /reports/org-units returns the seeded demo rollup", async () => {
    const res = await build().app.inject({
      method: "GET",
      url: "/reports/org-units",
      headers: H,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgUnits).toHaveLength(1);
    expect(body.orgUnits[0]).toMatchObject({
      name: "Demo School",
      code: "DEMO",
      courseCount: 1,
      enrollmentCount: 2,
      attendanceRate: 66.7,
      averageGrade: 92,
    });
    expect(body.summary).toMatchObject({
      orgUnitCount: 1,
      courseCount: 1,
      enrollmentCount: 2,
      attendanceRate: 66.7,
      averageGrade: 92,
    });
  });

  it("isolates tenants: a different tenant sees no rollups", async () => {
    const res = await build().app.inject({
      method: "GET",
      url: "/reports/org-units",
      headers: OTHER_H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orgUnits).toEqual([]);
    expect(res.json().summary).toMatchObject({
      orgUnitCount: 0,
      courseCount: 0,
      enrollmentCount: 0,
      attendanceRate: null,
      averageGrade: null,
    });
  });

  it("requires a tenant (400 without x-tenant-id)", async () => {
    const res = await build().app.inject({
      method: "GET",
      url: "/reports/org-units",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });
});
