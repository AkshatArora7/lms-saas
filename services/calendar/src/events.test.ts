import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { DEMO_TENANT_ID, MemoryCalendarEventStore } from "./events.memory.js";
import { toICalendar } from "./ical.js";
import { buildApp } from "./main.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};
const OTHER: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER.tenantId ? OTHER : TENANT;
}

function build(eventStore = new MemoryCalendarEventStore()) {
  return buildApp({ config, eventStore, resolveTenant });
}

const H = { "x-tenant-id": DEMO_TENANT_ID };
const OTHER_H = { "x-tenant-id": OTHER.tenantId };

describe("iCal generation (pure)", () => {
  it("renders timezone-correct UTC VEVENTs and escapes text", () => {
    const ics = toICalendar(
      [
        {
          id: "e1",
          tenantId: DEMO_TENANT_ID,
          orgUnitId: null,
          title: "Midterm; Room A, B",
          description: "Bring ID\nand pencil",
          startsAt: "2026-03-01T14:30:00.000Z",
          endsAt: "2026-03-01T16:00:00.000Z",
          allDay: false,
          sourceType: "manual",
          sourceId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      { stamp: "20260101T000000Z", calName: "My Cal" },
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART:20260301T143000Z");
    expect(ics).toContain("DTEND:20260301T160000Z");
    expect(ics).toContain("SUMMARY:Midterm\\; Room A\\, B");
    expect(ics).toContain("DESCRIPTION:Bring ID\\nand pencil");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("emits all-day events as DATE values", () => {
    const ics = toICalendar(
      [
        {
          id: "e2",
          tenantId: DEMO_TENANT_ID,
          orgUnitId: null,
          title: "Holiday",
          description: null,
          startsAt: "2026-07-04T00:00:00.000Z",
          endsAt: null,
          allDay: true,
          sourceType: "manual",
          sourceId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      { stamp: "20260101T000000Z" },
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260704");
  });
});

describe("calendar events (#58)", () => {
  it("health still reports ok", async () => {
    const res = await build().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("calendar");
  });

  it("creates a manual event and validates input", async () => {
    const app = build();
    const ok = await app.inject({
      method: "POST",
      url: "/calendar/events",
      headers: H,
      payload: { title: "Office hours", startsAt: "2026-03-02T15:00:00.000Z" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().event).toMatchObject({ sourceType: "manual" });

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/calendar/events",
          headers: H,
          payload: { title: "x", startsAt: "not-a-date" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/calendar/events",
          headers: H,
          payload: { startsAt: "2026-03-02T15:00:00.000Z" },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("upserts source events idempotently (aggregated due dates)", async () => {
    const app = build();
    const payload = {
      sourceType: "assignment",
      sourceId: "a0000000-0000-0000-0000-000000000001",
      title: "Essay due",
      startsAt: "2026-03-10T23:59:00.000Z",
    };
    const first = await app.inject({
      method: "PUT",
      url: "/calendar/events/source",
      headers: H,
      payload,
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().event.id;

    // Re-sync with a new time -> same row, updated (no duplicate).
    const second = await app.inject({
      method: "PUT",
      url: "/calendar/events/source",
      headers: H,
      payload: { ...payload, title: "Essay due (extended)", startsAt: "2026-03-12T23:59:00.000Z" },
    });
    expect(second.json().event.id).toBe(firstId);
    expect(second.json().event.title).toBe("Essay due (extended)");

    const list = await app.inject({ method: "GET", url: "/calendar/events", headers: H });
    expect(list.json().events).toHaveLength(1);
  });

  it("filters by time range and serves an iCal feed", async () => {
    const app = build();
    await app.inject({
      method: "POST",
      url: "/calendar/events",
      headers: H,
      payload: { title: "Jan", startsAt: "2026-01-15T10:00:00.000Z" },
    });
    await app.inject({
      method: "POST",
      url: "/calendar/events",
      headers: H,
      payload: { title: "Mar", startsAt: "2026-03-15T10:00:00.000Z" },
    });

    const jan = await app.inject({
      method: "GET",
      url: "/calendar/events?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z",
      headers: H,
    });
    expect(jan.json().events).toHaveLength(1);
    expect(jan.json().events[0].title).toBe("Jan");

    const feed = await app.inject({
      method: "GET",
      url: "/calendar/feed.ics",
      headers: H,
    });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers["content-type"]).toContain("text/calendar");
    expect(feed.body).toContain("BEGIN:VCALENDAR");
    expect(feed.body).toContain("SUMMARY:Jan");
    expect(feed.body).toContain("SUMMARY:Mar");
  });

  it("gets and deletes events; 404 for missing; isolates tenants", async () => {
    const app = build();
    const id = (
      await app.inject({
        method: "POST",
        url: "/calendar/events",
        headers: H,
        payload: { title: "E", startsAt: "2026-03-02T15:00:00.000Z" },
      })
    ).json().event.id;

    expect(
      (await app.inject({ method: "GET", url: `/calendar/events/${id}`, headers: H }))
        .statusCode,
    ).toBe(200);
    // Other tenant can't see it.
    expect(
      (await app.inject({ method: "GET", url: `/calendar/events/${id}`, headers: OTHER_H }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/calendar/events", headers: OTHER_H }))
        .json().events,
    ).toHaveLength(0);

    expect(
      (await app.inject({ method: "DELETE", url: `/calendar/events/${id}`, headers: H }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: `/calendar/events/${id}`, headers: H }))
        .statusCode,
    ).toBe(404);
  });
});
