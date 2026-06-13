import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryAnnouncementStore,
} from "./store.memory.js";
import { isVisible, statusOf, type AnnouncementRecord } from "./store.js";

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

function buildTestApp(store = new MemoryAnnouncementStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

async function create(
  app: ReturnType<typeof buildTestApp>,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/announcements",
    headers: HEADERS,
    payload: {
      orgUnitId: "course-1",
      authorId: "instructor-1",
      title: "Midterm next week",
      body: "Study chapters 1-5.",
      ...overrides,
    },
  });
}

const baseRecord: AnnouncementRecord = {
  id: "a1",
  tenantId: DEMO_TENANT_ID,
  orgUnitId: "course-1",
  authorId: null,
  title: "t",
  body: "b",
  publishAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("announcement service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "announcement", status: "ok" });
  });
});

describe("pure helpers", () => {
  it("classifies scheduled / published / expired", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(statusOf({ ...baseRecord, publishAt: "2026-12-01T00:00:00.000Z" }, now)).toBe(
      "scheduled",
    );
    expect(statusOf(baseRecord, now)).toBe("published");
    expect(
      statusOf({ ...baseRecord, expiresAt: "2026-02-01T00:00:00.000Z" }, now),
    ).toBe("expired");
  });

  it("isVisible honours publish and expiry windows", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(isVisible(baseRecord, now)).toBe(true);
    expect(isVisible({ ...baseRecord, publishAt: "2026-12-01T00:00:00.000Z" }, now)).toBe(
      false,
    );
    expect(isVisible({ ...baseRecord, expiresAt: "2026-02-01T00:00:00.000Z" }, now)).toBe(
      false,
    );
  });
});

describe("announcements", () => {
  it("creates an announcement (201) with published status", async () => {
    const app = buildTestApp();
    const res = await create(app);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      announcement: { title: "Midterm next week", status: "published" },
    });
  });

  it("requires orgUnitId, title and body (400)", async () => {
    const app = buildTestApp();
    const res = await create(app, { title: "" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed publishAt (400)", async () => {
    const app = buildTestApp();
    const res = await create(app, { publishAt: "not-a-date" });
    expect(res.statusCode).toBe(400);
  });

  it("schedules a future announcement and hides it from the visible list", async () => {
    const app = buildTestApp();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const created = await create(app, { publishAt: future });
    expect(created.json()).toMatchObject({
      announcement: { status: "scheduled" },
    });

    const visible = await app.inject({
      method: "GET",
      url: "/courses/course-1/announcements",
      headers: HEADERS,
    });
    expect(
      (visible.json() as { announcements: unknown[] }).announcements,
    ).toEqual([]);

    const all = await app.inject({
      method: "GET",
      url: "/courses/course-1/announcements?include=all",
      headers: HEADERS,
    });
    expect(
      (all.json() as { announcements: unknown[] }).announcements,
    ).toHaveLength(1);
  });

  it("publishes a scheduled announcement immediately", async () => {
    const app = buildTestApp();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const created = await create(app, { publishAt: future });
    const id = (created.json() as { announcement: { id: string } }).announcement
      .id;

    const published = await app.inject({
      method: "POST",
      url: `/announcements/${id}/publish`,
      headers: HEADERS,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      announcement: { status: "published" },
    });
  });

  it("updates title/body via PATCH", async () => {
    const app = buildTestApp();
    const created = await create(app);
    const id = (created.json() as { announcement: { id: string } }).announcement
      .id;
    const res = await app.inject({
      method: "PATCH",
      url: `/announcements/${id}`,
      headers: HEADERS,
      payload: { title: "Updated title" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      announcement: { title: "Updated title" },
    });
  });

  it("deletes an announcement", async () => {
    const app = buildTestApp();
    const created = await create(app);
    const id = (created.json() as { announcement: { id: string } }).announcement
      .id;
    const del = await app.inject({
      method: "DELETE",
      url: `/announcements/${id}`,
      headers: HEADERS,
    });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: `/announcements/${id}`,
      headers: HEADERS,
    });
    expect(get.statusCode).toBe(404);
  });

  it("returns 404 for an unknown announcement", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/announcements/missing",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's announcements", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const ours = await app.inject({
      method: "GET",
      url: "/courses/demo-course/announcements",
      headers: HEADERS,
    });
    expect(
      (ours.json() as { announcements: unknown[] }).announcements,
    ).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: "/courses/demo-course/announcements",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect(
      (theirs.json() as { announcements: unknown[] }).announcements,
    ).toEqual([]);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/courses/course-1/announcements",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
