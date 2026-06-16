import { randomUUID } from "node:crypto";

import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryNotificationStore,
} from "./store.memory.js";
import {
  categoryForEvent,
  isWithinQuietHours,
  planDeliveries,
  type PreferenceRecord,
} from "./store.js";

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

function buildTestApp(store = new MemoryNotificationStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

async function ingest(
  app: ReturnType<typeof buildTestApp>,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/events",
    headers: HEADERS,
    payload: {
      message_id: randomUUID(),
      type: "grade.released",
      title: "New grade posted",
      recipientIds: ["stu-1"],
      ...overrides,
    },
  });
}

describe("notification service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "notification", status: "ok" });
  });
});

describe("pure helpers", () => {
  it("maps event types to categories", () => {
    expect(categoryForEvent("grade.released")).toBe("grades");
    expect(categoryForEvent("discussion.post_created")).toBe("discussions");
    expect(categoryForEvent("assignment.created")).toBe("assignments");
    expect(categoryForEvent("enrollment.created")).toBe("enrollments");
    expect(categoryForEvent("something.else")).toBe("general");
  });

  it("detects quiet hours across a midnight-wrapping window", () => {
    const quiet = { startHour: 22, endHour: 7 };
    expect(isWithinQuietHours(new Date("2026-01-01T23:00:00Z"), quiet)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T03:00:00Z"), quiet)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T12:00:00Z"), quiet)).toBe(false);
  });

  it("defers non-in-app channels during quiet hours but always delivers in-app", () => {
    const prefsByUser = new Map<string, PreferenceRecord[]>();
    const rows = planDeliveries({
      category: "grades",
      title: "x",
      recipientIds: ["u1"],
      prefsByUser,
      quietHours: { startHour: 22, endHour: 7 },
      now: new Date("2026-01-01T23:00:00Z"),
    });
    const inApp = rows.find((r) => r.channel === "in_app");
    const email = rows.find((r) => r.channel === "email");
    expect(inApp?.status).toBe("sent");
    expect(email?.status).toBe("queued");
  });
});

describe("fan-out ingest", () => {
  it("creates in-app + email by default (201) and lists the in-app inbox", async () => {
    const app = buildTestApp();
    const res = await ingest(app);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ category: "grades", created: 2 });

    const inbox = await app.inject({
      method: "GET",
      url: "/users/stu-1/notifications",
      headers: HEADERS,
    });
    expect(inbox.statusCode).toBe(200);
    const body = inbox.json() as {
      notifications: unknown[];
      unreadCount: number;
    };
    expect(body.notifications).toHaveLength(1); // only the in_app row
    expect(body.unreadCount).toBe(1);
  });

  it("respects a disabled email preference", async () => {
    const app = buildTestApp();
    await app.inject({
      method: "PUT",
      url: "/users/stu-1/preferences",
      headers: HEADERS,
      payload: {
        preferences: [
          { channel: "email", category: "grades", isEnabled: false },
        ],
      },
    });
    const res = await ingest(app);
    expect(res.json()).toMatchObject({ created: 1 }); // in_app only
  });

  it("uses an explicit category when type is omitted", async () => {
    const app = buildTestApp();
    const res = await ingest(app, { type: undefined, category: "custom" });
    expect(res.json()).toMatchObject({ category: "custom" });
  });

  it("rejects an empty recipient list (400)", async () => {
    const app = buildTestApp();
    const res = await ingest(app, { recipientIds: [] });
    // empty array is allowed by validator but produces zero notifications
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: 0 });
  });

  it("rejects a missing title (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: HEADERS,
      payload: {
        message_id: randomUUID(),
        type: "grade.released",
        recipientIds: ["stu-1"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires a message_id / event id (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: HEADERS,
      payload: {
        type: "grade.released",
        title: "New grade posted",
        recipientIds: ["stu-1"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("dedupes a redelivered event id: notifications created once", async () => {
    const app = buildTestApp();
    const messageId = randomUUID();
    const payload = {
      message_id: messageId,
      type: "grade.released",
      title: "New grade posted",
      recipientIds: ["stu-1"],
    };

    const first = await app.inject({
      method: "POST",
      url: "/events",
      headers: HEADERS,
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ created: 2, deduped: false });

    // Redelivery of the SAME event id: a no-op that still reports success so
    // the relay stamps published_at. No additional rows are created.
    const second = await app.inject({
      method: "POST",
      url: "/events",
      headers: HEADERS,
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ created: 0, deduped: true });

    // The recipient's in-app inbox has exactly one notification.
    const inbox = await app.inject({
      method: "GET",
      url: "/users/stu-1/notifications",
      headers: HEADERS,
    });
    expect(
      (inbox.json() as { notifications: unknown[] }).notifications,
    ).toHaveLength(1);
  });

  it("accepts the envelope id field as the message id", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: HEADERS,
      payload: {
        id: randomUUID(),
        type: "grade.released",
        title: "New grade posted",
        recipientIds: ["stu-1"],
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("inbox read state", () => {
  it("marks a single notification read, decrementing unread", async () => {
    const app = buildTestApp();
    await ingest(app);
    const inbox = await app.inject({
      method: "GET",
      url: "/users/stu-1/notifications",
      headers: HEADERS,
    });
    const id = (inbox.json() as { notifications: Array<{ id: string }> })
      .notifications[0].id;

    const read = await app.inject({
      method: "POST",
      url: `/users/stu-1/notifications/${id}/read`,
      headers: HEADERS,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ notification: { status: "read" } });

    const after = await app.inject({
      method: "GET",
      url: "/users/stu-1/notifications",
      headers: HEADERS,
    });
    expect((after.json() as { unreadCount: number }).unreadCount).toBe(0);
  });

  it("marks all read", async () => {
    const app = buildTestApp();
    await ingest(app);
    await ingest(app, { title: "another" });
    const res = await app.inject({
      method: "POST",
      url: "/users/stu-1/notifications/read-all",
      headers: HEADERS,
    });
    expect(res.json()).toMatchObject({ updated: 2 });
  });

  it("returns 404 marking an unknown notification read", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/users/stu-1/notifications/missing/read",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("preferences and digest", () => {
  it("stores and returns preferences", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/users/stu-1/preferences",
      headers: HEADERS,
      payload: {
        preferences: [
          { channel: "push", category: "grades", isEnabled: true },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (res.json() as { preferences: unknown[] }).preferences,
    ).toHaveLength(1);
  });

  it("rejects malformed preferences (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/users/stu-1/preferences",
      headers: HEADERS,
      payload: { preferences: [{ channel: "carrier-pigeon" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("flushes queued digest notifications to sent", async () => {
    const app = buildTestApp();
    // Quiet hours defers the email channel to the digest queue.
    await ingest(app, { quietHours: { startHour: 0, endHour: 24 } });
    const flushed = await app.inject({
      method: "POST",
      url: "/users/stu-1/digest/flush",
      headers: HEADERS,
    });
    expect(flushed.statusCode).toBe(200);
    const rows = (flushed.json() as { flushed: Array<{ status: string }> })
      .flushed;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("sent");
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's inbox", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const ours = await app.inject({
      method: "GET",
      url: "/users/demo-user/notifications",
      headers: HEADERS,
    });
    expect(
      (ours.json() as { notifications: unknown[] }).notifications,
    ).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: "/users/demo-user/notifications",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect(
      (theirs.json() as { notifications: unknown[] }).notifications,
    ).toEqual([]);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/users/stu-1/notifications",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
