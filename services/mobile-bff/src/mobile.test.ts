import { signAccessToken } from "@lms/auth";
import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  UpstreamError,
  type DeviceInput,
  type UpstreamClient,
  type UpstreamContext,
} from "./upstream.js";

const JWT_SECRET = "test-secret-at-least-16-chars-long";
const JWT_AUDIENCE = "lms-api";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "99999999-9999-9999-9999-999999999999";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  JWT_SECRET,
  JWT_AUDIENCE,
} as unknown as AppConfig;

/** A controllable fake upstream that records the contexts it was called with. */
function fakeUpstream(overrides: Partial<UpstreamClient> = {}): {
  client: UpstreamClient;
  calls: { name: string; ctx: UpstreamContext }[];
} {
  const calls: { name: string; ctx: UpstreamContext }[] = [];
  const rec =
    <T>(name: string, value: T) =>
    async (ctx: UpstreamContext) => {
      calls.push({ name, ctx });
      return value;
    };
  const client: UpstreamClient = {
    listEnrolledCourses: rec("listEnrolledCourses", [
      { id: "c1", title: "Biology" },
    ]),
    listDueSoon: rec("listDueSoon", [
      { id: "e1", title: "Essay", startsAt: "2026-07-01T00:00:00.000Z" },
    ]),
    unreadCount: rec("unreadCount", 3),
    listNotifications: rec("listNotifications", [
      { id: "n1", title: "Graded", readAt: null },
      { id: "n2", title: "Welcome", readAt: "2026-06-01T00:00:00.000Z" },
    ]),
    getCourse: async (ctx) => {
      calls.push({ name: "getCourse", ctx });
      return { id: "c1", title: "Biology" };
    },
    listCourseAssignments: async (ctx) => {
      calls.push({ name: "listCourseAssignments", ctx });
      return [{ id: "a1", title: "Lab 1" }];
    },
    submitAssignment: async (ctx) => {
      calls.push({ name: "submitAssignment", ctx });
      return { id: "s1", status: "submitted" };
    },
    registerDevice: async (ctx, input: DeviceInput) => {
      calls.push({ name: "registerDevice", ctx });
      return { id: "d1", platform: input.platform };
    },
    ...overrides,
  };
  return { client, calls };
}

async function token(opts: { secret?: string } = {}): Promise<string> {
  return signAccessToken(
    {
      sub: USER_ID,
      tenantId: TENANT_ID,
      parentTenantId: null,
      tier: "pool",
      roles: ["student"],
      scopes: [],
    },
    { secret: opts.secret ?? JWT_SECRET, audience: JWT_AUDIENCE },
  );
}

function build(upstream: UpstreamClient) {
  return buildApp({ config, upstream });
}

async function authHeader() {
  return { authorization: `Bearer ${await token()}` };
}

describe("mobile BFF (#79)", () => {
  it("health reports ok", async () => {
    const res = await build(fakeUpstream().client).inject({
      method: "GET",
      url: "/health",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("mobile-bff");
  });

  it("home aggregates courses, due-soon and unread badge, forwarding the token", async () => {
    const up = fakeUpstream();
    const res = await build(up.client).inject({
      method: "GET",
      url: "/mobile/home",
      headers: await authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toEqual({ id: USER_ID, roles: ["student"] });
    expect(body.courses).toHaveLength(1);
    expect(body.dueSoon).toHaveLength(1);
    expect(body.unreadCount).toBe(3);
    // Token + identity were forwarded to every upstream call.
    expect(up.calls.length).toBeGreaterThanOrEqual(3);
    for (const c of up.calls) {
      expect(c.ctx.userId).toBe(USER_ID);
      expect(c.ctx.tenantId).toBe(TENANT_ID);
      expect(typeof c.ctx.token).toBe("string");
    }
  });

  it("fails closed with no token, a malformed token, or a wrong-secret token", async () => {
    const app = build(fakeUpstream().client);
    expect(
      (await app.inject({ method: "GET", url: "/mobile/home" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/mobile/home",
          headers: { authorization: "Bearer not.a.jwt" },
        })
      ).statusCode,
    ).toBe(401);
    const forged = await token({ secret: "a-different-secret-16chars+" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/mobile/home",
          headers: { authorization: `Bearer ${forged}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("course screen returns course + assignments and 404s a missing course", async () => {
    const ok = await build(fakeUpstream().client).inject({
      method: "GET",
      url: "/mobile/courses/c1",
      headers: await authHeader(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().course.id).toBe("c1");
    expect(ok.json().assignments).toHaveLength(1);

    const missing = await build(
      fakeUpstream({ getCourse: async () => null }).client,
    ).inject({
      method: "GET",
      url: "/mobile/courses/nope",
      headers: await authHeader(),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("notifications screen computes the unread count", async () => {
    const res = await build(fakeUpstream().client).inject({
      method: "GET",
      url: "/mobile/notifications",
      headers: await authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(2);
    expect(res.json().unreadCount).toBe(1);
  });

  it("submits work and validates the payload", async () => {
    const app = build(fakeUpstream().client);
    const ok = await app.inject({
      method: "POST",
      url: "/mobile/assignments/a1/submissions",
      headers: await authHeader(),
      payload: { content: "My essay" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().submission.status).toBe("submitted");

    const bad = await app.inject({
      method: "POST",
      url: "/mobile/assignments/a1/submissions",
      headers: await authHeader(),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
  });

  it("registers a push device and validates platform + token", async () => {
    const app = build(fakeUpstream().client);
    const ok = await app.inject({
      method: "POST",
      url: "/mobile/devices",
      headers: await authHeader(),
      payload: { platform: "ios", pushToken: "apns-token-abc" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().device).toMatchObject({ platform: "ios" });

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/mobile/devices",
          headers: await authHeader(),
          payload: { platform: "blackberry", pushToken: "x" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/mobile/devices",
          headers: await authHeader(),
          payload: { platform: "ios" },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("maps upstream auth errors through and collapses 5xx to 502", async () => {
    const forbidden = build(
      fakeUpstream({
        submitAssignment: async () => {
          throw new UpstreamError(403, "forbidden");
        },
      }).client,
    );
    expect(
      (
        await forbidden.inject({
          method: "POST",
          url: "/mobile/assignments/a1/submissions",
          headers: await authHeader(),
          payload: { content: "x" },
        })
      ).statusCode,
    ).toBe(403);

    const broken = build(
      fakeUpstream({
        listEnrolledCourses: async () => {
          throw new UpstreamError(500, "boom");
        },
      }).client,
    );
    expect(
      (
        await broken.inject({
          method: "GET",
          url: "/mobile/home",
          headers: await authHeader(),
        })
      ).statusCode,
    ).toBe(502);
  });
});
