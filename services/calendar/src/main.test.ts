import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemorySchedulingStore,
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

function buildTestApp(store = new MemorySchedulingStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

const SCHEDULE_PAYLOAD = {
  orgUnitId: "school-1",
  name: "Standard Day",
  timezone: "America/Toronto",
  periods: [
    { name: "Period 1", startTime: "08:30", endTime: "09:20" },
    { name: "Period 2", startTime: "09:25", endTime: "10:15" },
  ],
};

describe("calendar service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "calendar", status: "ok" });
  });
});

describe("bell schedules", () => {
  it("creates a schedule with periods (201) then fetches it", async () => {
    const app = buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/schedules",
      headers: HEADERS,
      payload: SCHEDULE_PAYLOAD,
    });
    expect(created.statusCode).toBe(201);
    const { schedule } = created.json() as {
      schedule: { id: string; periods: unknown[] };
    };
    expect(schedule.periods).toHaveLength(2);

    const fetched = await app.inject({
      method: "GET",
      url: `/schedules/${schedule.id}`,
      headers: HEADERS,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      schedule: { name: "Standard Day" },
    });
  });

  it("rejects a schedule with no periods (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/schedules",
      headers: HEADERS,
      payload: { orgUnitId: "school-1", name: "Empty", periods: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists seeded schedules filtered by tenant", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const ours = await app.inject({
      method: "GET",
      url: "/schedules",
      headers: HEADERS,
    });
    expect((ours.json() as { schedules: unknown[] }).schedules).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: "/schedules",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect((theirs.json() as { schedules: unknown[] }).schedules).toEqual([]);
  });

  it("returns 404 for a missing schedule", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/schedules/nope",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("timetable", () => {
  it("creates an entry (201) and lists it for the instructor", async () => {
    const app = buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: {
        orgUnitId: "section-a",
        periodId: "period-1",
        instructorId: "teacher-1",
        room: "Room 101",
        dayOfWeek: 1,
      },
    });
    expect(created.statusCode).toBe(201);

    const personal = await app.inject({
      method: "GET",
      url: "/users/teacher-1/timetable",
      headers: HEADERS,
    });
    expect(personal.statusCode).toBe(200);
    expect((personal.json() as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it("detects a room conflict (409)", async () => {
    const app = buildTestApp();
    const base = {
      periodId: "period-1",
      room: "Room 101",
      dayOfWeek: 1,
    };
    await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: { ...base, orgUnitId: "section-a", instructorId: "teacher-1" },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: { ...base, orgUnitId: "section-b", instructorId: "teacher-2" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: "timetable_conflict",
      conflict: "room",
    });
  });

  it("detects an instructor conflict (409)", async () => {
    const app = buildTestApp();
    await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: {
        orgUnitId: "section-a",
        periodId: "period-1",
        instructorId: "teacher-1",
        room: "Room 101",
        dayOfWeek: 2,
      },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: {
        orgUnitId: "section-b",
        periodId: "period-1",
        instructorId: "teacher-1",
        room: "Room 202",
        dayOfWeek: 2,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ conflict: "instructor" });
  });

  it("detects a section slot conflict (409)", async () => {
    const app = buildTestApp();
    const payload = {
      orgUnitId: "section-a",
      periodId: "period-1",
      dayOfWeek: 3,
    };
    await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload,
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ conflict: "slot" });
  });

  it("allows the same room in a different period", async () => {
    const app = buildTestApp();
    await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: {
        orgUnitId: "section-a",
        periodId: "period-1",
        room: "Room 101",
        dayOfWeek: 1,
      },
    });
    const ok = await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: {
        orgUnitId: "section-b",
        periodId: "period-2",
        room: "Room 101",
        dayOfWeek: 1,
      },
    });
    expect(ok.statusCode).toBe(201);
  });

  it("rejects an invalid dayOfWeek (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/timetable",
      headers: HEADERS,
      payload: { orgUnitId: "section-a", periodId: "period-1", dayOfWeek: 9 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/schedules" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
