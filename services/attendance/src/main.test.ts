import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { attendanceEvent, recipientsFor } from "./events.js";
import { FakeGuardianChildrenResolver } from "./guardian-resolver.memory.js";
import { MemoryStudentGuardiansResolver } from "./guardians.memory.js";
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

describe("absence/tardy notifications (#191)", () => {
  it("emits a flagged event per absent/tardy record on finalize", async () => {
    const store = createSeededMemoryStore();
    const app = buildApp({ config, store, resolveTenant });
    const session = (await openSession(app)).json().session;

    await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/records`,
      headers: HEADERS,
      payload: {
        records: [
          { userId: "stu-present", code: "P" },
          { userId: "stu-absent", code: "A" },
          { userId: "stu-tardy", code: "T", minutesLate: 5 },
        ],
      },
    });

    // No events before finalize.
    expect(store.emittedEvents()).toHaveLength(0);

    const finalized = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/finalize`,
      headers: HEADERS,
    });
    expect(finalized.statusCode).toBe(200);

    const events = store.emittedEvents();
    expect(events).toHaveLength(2); // absent + tardy (present is not flagged)
    expect(events.every((e) => e.type === "attendance.flagged")).toBe(true);
    const byUser = Object.fromEntries(
      events.map((e) => [e.payload.userId, e.payload]),
    );
    expect(byUser["stu-absent"]).toMatchObject({
      category: "absent",
      recipientIds: ["stu-absent"],
    });
    expect(byUser["stu-tardy"]).toMatchObject({ category: "tardy" });
    expect(byUser["stu-present"]).toBeUndefined();
  });
});

describe("attendanceEvent (pure builder)", () => {
  it("uses the explicit recipient list verbatim", () => {
    const event = attendanceEvent(
      "session-1",
      "section-a",
      { userId: "stu-1", code: "A", category: "absent" },
      ["stu-1", "guardian-1"],
    );
    expect(event.type).toBe("attendance.flagged");
    expect(event.payload).toMatchObject({
      userId: "stu-1", // subject learner is unchanged
      recipientIds: ["stu-1", "guardian-1"],
    });
  });

  it("recipientsFor puts the learner first and dedupes", () => {
    expect(recipientsFor("stu-1", ["g-1", "g-2"])).toEqual([
      "stu-1",
      "g-1",
      "g-2",
    ]);
    // Edge: a guardian id equal to the learner appears once.
    expect(recipientsFor("stu-1", ["stu-1", "g-1"])).toEqual(["stu-1", "g-1"]);
  });
});

describe("guardian notification fan-out on finalize (#101)", () => {
  const GUARDIAN = "guardian-1";
  const OTHER_GUARDIAN = "guardian-b";

  async function finalizeWith(resolver: MemoryStudentGuardiansResolver) {
    const store = createSeededMemoryStore(undefined, resolver);
    const app = buildApp({ config, store, resolveTenant });
    const session = (await openSession(app)).json().session;
    await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/records`,
      headers: HEADERS,
      payload: {
        records: [
          { userId: "stu-absent", code: "A" },
          { userId: "stu-tardy", code: "T", minutesLate: 5 },
          { userId: "stu-present", code: "P" },
        ],
      },
    });
    await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/finalize`,
      headers: HEADERS,
    });
    return store.emittedEvents();
  }

  it("includes a linked active+consented guardian alongside the learner", async () => {
    const resolver = new MemoryStudentGuardiansResolver().set(
      TENANT,
      "stu-absent",
      [GUARDIAN],
    );
    const events = await finalizeWith(resolver);
    const byUser = Object.fromEntries(
      events.map((e) => [e.payload.userId, e.payload]),
    );
    expect(byUser["stu-absent"].recipientIds).toEqual(["stu-absent", GUARDIAN]);
    // The learner is always still a recipient (here with no guardian seeded).
    expect(byUser["stu-tardy"].recipientIds).toEqual(["stu-tardy"]);
  });

  it("does not include a guardian for a non-linked student", async () => {
    // Only stu-tardy has a guardian; stu-absent has none.
    const resolver = new MemoryStudentGuardiansResolver().set(
      TENANT,
      "stu-tardy",
      [GUARDIAN],
    );
    const events = await finalizeWith(resolver);
    const byUser = Object.fromEntries(
      events.map((e) => [e.payload.userId, e.payload]),
    );
    expect(byUser["stu-absent"].recipientIds).toEqual(["stu-absent"]);
    expect(byUser["stu-tardy"].recipientIds).toEqual(["stu-tardy", GUARDIAN]);
  });

  it("keeps the learner as a recipient and dedupes a learner==guardian edge", async () => {
    const resolver = new MemoryStudentGuardiansResolver().set(
      TENANT,
      "stu-absent",
      ["stu-absent", GUARDIAN],
    );
    const events = await finalizeWith(resolver);
    const absent = events.find((e) => e.payload.userId === "stu-absent")!;
    expect(absent.payload.recipientIds).toEqual(["stu-absent", GUARDIAN]);
  });

  it("is tenant-scoped: a guardian in tenant B is not added for a tenant A student", async () => {
    // Seed the guardian under the OTHER tenant only; the finalize runs as the
    // demo (A) tenant, so it must NOT pick up tenant B's guardian.
    const resolver = new MemoryStudentGuardiansResolver().set(
      OTHER_TENANT,
      "stu-absent",
      [OTHER_GUARDIAN],
    );
    const events = await finalizeWith(resolver);
    const absent = events.find((e) => e.payload.userId === "stu-absent")!;
    expect(absent.payload.recipientIds).toEqual(["stu-absent"]);
  });
});

describe("guardian-scoped attendance view (#190)", () => {
  const GUARDIAN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const CHILD = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const OTHER_CHILD = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  /** Resolve caller from the trusted x-user-id header (mirrors prod). */
  function resolveCaller(req: FastifyRequest) {
    const userId = req.headers["x-user-id"];
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("missing x-user-id");
    }
    return { userId, roles: [] };
  }

  /** Seed CHILD's attendance under the demo tenant and return the store. */
  async function seedChildHistory(store: MemoryAttendanceStore) {
    await store.seedDefaultCodes(TENANT);
    const session = await store.createSession(TENANT, {
      orgUnitId: "section-a",
      meetingDate: "2026-03-01",
      periodLabel: "Period 1",
    });
    if (!session.ok) throw new Error("seed session failed");
    await store.setRecords(TENANT, session.session.id, [
      { userId: CHILD, code: "P" },
    ]);
    return store;
  }

  function buildGuardianApp(
    store: MemoryAttendanceStore,
    resolver: FakeGuardianChildrenResolver,
  ) {
    return buildApp({
      config,
      store,
      resolveTenant,
      resolveCaller,
      guardianResolver: resolver,
    });
  }

  const GUARDIAN_H = { "x-tenant-id": DEMO_TENANT_ID, "x-user-id": GUARDIAN };

  it("lists only the caller's authorized children", async () => {
    const resolver = new FakeGuardianChildrenResolver([
      {
        tenantId: DEMO_TENANT_ID,
        guardianUserId: GUARDIAN,
        children: [{ studentUserId: CHILD, relationship: "parent" }],
      },
    ]);
    const app = buildGuardianApp(new MemoryAttendanceStore(), resolver);
    const res = await app.inject({
      method: "GET",
      url: "/guardian/children",
      headers: GUARDIAN_H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().children).toEqual([
      { studentUserId: CHILD, relationship: "parent" },
    ]);
  });

  it("returns a linked, active+consented child's attendance (happy path)", async () => {
    const store = await seedChildHistory(new MemoryAttendanceStore());
    const resolver = new FakeGuardianChildrenResolver([
      {
        tenantId: DEMO_TENANT_ID,
        guardianUserId: GUARDIAN,
        children: [{ studentUserId: CHILD, relationship: "parent" }],
      },
    ]);
    const app = buildGuardianApp(store, resolver);
    const res = await app.inject({
      method: "GET",
      url: `/guardian/children/${CHILD}/attendance`,
      headers: GUARDIAN_H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().studentId).toBe(CHILD);
    expect(res.json().history).toHaveLength(1);
    expect(res.json().history[0]).toMatchObject({ code: "P", category: "present" });
  });

  it("denies a non-linked (cross-family) student with 404 and never reads history", async () => {
    const store = await seedChildHistory(new MemoryAttendanceStore());
    // OTHER_CHILD has attendance, but G is NOT linked to them.
    const other = await store.createSession(TENANT, {
      orgUnitId: "section-b",
      meetingDate: "2026-03-02",
    });
    if (other.ok) {
      await store.setRecords(TENANT, other.session.id, [
        { userId: OTHER_CHILD, code: "A" },
      ]);
    }
    const resolver = new FakeGuardianChildrenResolver([
      {
        tenantId: DEMO_TENANT_ID,
        guardianUserId: GUARDIAN,
        children: [{ studentUserId: CHILD, relationship: "parent" }],
      },
    ]);
    const app = buildGuardianApp(store, resolver);
    const historySpy = vi.spyOn(store, "userHistory");
    const res = await app.inject({
      method: "GET",
      url: `/guardian/children/${OTHER_CHILD}/attendance`,
      headers: GUARDIAN_H,
    });
    expect(res.statusCode).toBe(404);
    // Deny-by-default: no attendance read is ever attempted for a denied id.
    expect(
      historySpy.mock.calls.some((c) => c[1] === OTHER_CHILD),
    ).toBe(false);
  });

  it("denies a revoked/non-consented child (resolver excludes it) with 404", async () => {
    // The fake resolver returns an EMPTY set for G — i.e. user-org filtered out
    // the link (revoked) or the consent (non-consented). Either collapses to
    // "not in the authorized set" → 404.
    const store = await seedChildHistory(new MemoryAttendanceStore());
    const resolver = new FakeGuardianChildrenResolver([]);
    const app = buildGuardianApp(store, resolver);
    const children = await app.inject({
      method: "GET",
      url: "/guardian/children",
      headers: GUARDIAN_H,
    });
    expect(children.json().children).toEqual([]);
    const res = await app.inject({
      method: "GET",
      url: `/guardian/children/${CHILD}/attendance`,
      headers: GUARDIAN_H,
    });
    expect(res.statusCode).toBe(404);
  });

  it("ignores a spoofed guardianId param/query — identity comes from x-user-id only", async () => {
    // CHILD is authorized for GUARDIAN, not for the spoofed attacker id. The
    // attacker authenticates as themselves (x-user-id) but tries to name G via a
    // query param; the param is ignored and they see nothing.
    const store = await seedChildHistory(new MemoryAttendanceStore());
    const ATTACKER = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const resolver = new FakeGuardianChildrenResolver([
      {
        tenantId: DEMO_TENANT_ID,
        guardianUserId: GUARDIAN,
        children: [{ studentUserId: CHILD, relationship: "parent" }],
      },
    ]);
    const app = buildGuardianApp(store, resolver);
    const children = await app.inject({
      method: "GET",
      url: `/guardian/children?guardianUserId=${GUARDIAN}&guardianId=${GUARDIAN}`,
      headers: { "x-tenant-id": DEMO_TENANT_ID, "x-user-id": ATTACKER },
    });
    expect(children.json().children).toEqual([]);
    const attendance = await app.inject({
      method: "GET",
      url: `/guardian/children/${CHILD}/attendance?guardianUserId=${GUARDIAN}`,
      headers: { "x-tenant-id": DEMO_TENANT_ID, "x-user-id": ATTACKER },
    });
    expect(attendance.statusCode).toBe(404);
  });

  it("fails closed with 401 when x-user-id is absent", async () => {
    const app = buildGuardianApp(
      new MemoryAttendanceStore(),
      new FakeGuardianChildrenResolver([]),
    );
    const list = await app.inject({
      method: "GET",
      url: "/guardian/children",
      headers: { "x-tenant-id": DEMO_TENANT_ID },
    });
    expect(list.statusCode).toBe(401);
    const detail = await app.inject({
      method: "GET",
      url: `/guardian/children/${CHILD}/attendance`,
      headers: { "x-tenant-id": DEMO_TENANT_ID },
    });
    expect(detail.statusCode).toBe(401);
  });

  it("isolates tenants — a guardian in tenant A cannot read tenant B's child", async () => {
    const store = await seedChildHistory(new MemoryAttendanceStore());
    // Resolver only authorizes the child under the DEMO tenant, not OTHER.
    const resolver = new FakeGuardianChildrenResolver([
      {
        tenantId: DEMO_TENANT_ID,
        guardianUserId: GUARDIAN,
        children: [{ studentUserId: CHILD, relationship: "parent" }],
      },
    ]);
    const app = buildGuardianApp(store, resolver);
    // Same guardian + child ids, but carrying tenant B's x-tenant-id.
    const otherHeaders = {
      "x-tenant-id": OTHER_TENANT.tenantId,
      "x-user-id": GUARDIAN,
    };
    const children = await app.inject({
      method: "GET",
      url: "/guardian/children",
      headers: otherHeaders,
    });
    expect(children.json().children).toEqual([]);
    const attendance = await app.inject({
      method: "GET",
      url: `/guardian/children/${CHILD}/attendance`,
      headers: otherHeaders,
    });
    expect(attendance.statusCode).toBe(404);
  });

  it("returns an empty set (200) for a guardian with no authorized children", async () => {
    const app = buildGuardianApp(
      new MemoryAttendanceStore(),
      new FakeGuardianChildrenResolver([]),
    );
    const res = await app.inject({
      method: "GET",
      url: "/guardian/children",
      headers: GUARDIAN_H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().children).toEqual([]);
  });

  it("400s on a non-uuid studentId", async () => {
    const app = buildGuardianApp(
      new MemoryAttendanceStore(),
      new FakeGuardianChildrenResolver([]),
    );
    const res = await app.inject({
      method: "GET",
      url: "/guardian/children/not-a-uuid/attendance",
      headers: GUARDIAN_H,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("attendance compliance/SIS export (#377)", () => {
  const ADMIN = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const STUDENT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const SECTION = "ffffffff-ffff-ffff-ffff-ffffffffffff";

  /** Caller resolver reading x-user-id + x-user-roles (mirrors prod). */
  function resolveCaller(req: FastifyRequest) {
    const userId = req.headers["x-user-id"];
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("missing x-user-id");
    }
    const rolesHeader = req.headers["x-user-roles"];
    const roles =
      typeof rolesHeader === "string"
        ? rolesHeader.split(",").map((r) => r.trim()).filter(Boolean)
        : [];
    return { userId, roles };
  }

  function buildExportApp(store: MemoryAttendanceStore) {
    return buildApp({ config, store, resolveTenant, resolveCaller });
  }

  /** Seed one absent record in [SECTION] on 2026-03-02 under the demo tenant. */
  async function seedExport(
    store: MemoryAttendanceStore,
    ctx = TENANT,
    section = SECTION,
  ) {
    await store.seedDefaultCodes(ctx);
    const session = await store.createSession(ctx, {
      orgUnitId: section,
      meetingDate: "2026-03-02",
      periodLabel: "Period 1",
    });
    if (!session.ok) throw new Error("seed session failed");
    await store.setRecords(ctx, session.session.id, [
      { userId: STUDENT, code: "A", comment: "late, sick" },
    ]);
    return session.session.id;
  }

  const ADMIN_H = {
    "x-tenant-id": DEMO_TENANT_ID,
    "x-user-id": ADMIN,
    "x-user-roles": "org_admin",
  };

  it("401s when no caller identity is present", async () => {
    const app = buildExportApp(new MemoryAttendanceStore());
    const res = await app.inject({
      method: "GET",
      url: "/export?from=2026-03-01&to=2026-03-31",
      headers: { "x-tenant-id": DEMO_TENANT_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the caller is not an admin/compliance role", async () => {
    const app = buildExportApp(new MemoryAttendanceStore());
    const res = await app.inject({
      method: "GET",
      url: "/export?from=2026-03-01&to=2026-03-31",
      headers: {
        "x-tenant-id": DEMO_TENANT_ID,
        "x-user-id": ADMIN,
        "x-user-roles": "instructor,learner",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden");
  });

  it("400s on a missing/invalid date range", async () => {
    const app = buildExportApp(new MemoryAttendanceStore());
    const missing = await app.inject({
      method: "GET",
      url: "/export",
      headers: ADMIN_H,
    });
    expect(missing.statusCode).toBe(400);

    const reversed = await app.inject({
      method: "GET",
      url: "/export?from=2026-03-31&to=2026-03-01",
      headers: ADMIN_H,
    });
    expect(reversed.statusCode).toBe(400);

    const bad = await app.inject({
      method: "GET",
      url: "/export?from=2026-13-01&to=2026-03-31",
      headers: ADMIN_H,
    });
    expect(bad.statusCode).toBe(400);
  });

  it("200s CSV for an admin with the stable header and RFC-4180 quoting", async () => {
    const store = new MemoryAttendanceStore();
    await seedExport(store);
    const app = buildExportApp(store);
    const res = await app.inject({
      method: "GET",
      url: "/export?from=2026-03-01&to=2026-03-31",
      headers: ADMIN_H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(
      'filename="attendance_2026-03-01_2026-03-31.csv"',
    );
    const lines = res.body.split("\r\n");
    expect(lines[0]).toBe(
      "tenant_id,section_id,meeting_date,period_label,student_id,code,category,minutes_late,comment",
    );
    expect(lines[1]).toContain(`${DEMO_TENANT_ID},${SECTION},2026-03-02`);
    expect(lines[1]).toContain('"late, sick"');
  });

  it("filters to a single section via sectionId", async () => {
    const store = new MemoryAttendanceStore();
    await seedExport(store);
    const app = buildExportApp(store);
    const other = "abababab-abab-abab-abab-abababababab";
    const res = await app.inject({
      method: "GET",
      url: `/export?from=2026-03-01&to=2026-03-31&sectionId=${other}`,
      headers: ADMIN_H,
    });
    expect(res.statusCode).toBe(200);
    // header only — no row matches the other section.
    expect(res.body.split("\r\n")).toHaveLength(1);
  });

  it("200s OneRoster JSON using sis_id_map with internal-uuid fallback", async () => {
    const store = new MemoryAttendanceStore();
    await seedExport(store);
    // Map the student to a SIS sourcedId but leave the class unmapped → fallback.
    store.seedSisIdMap(DEMO_TENANT_ID, {
      entityType: "user",
      internalId: STUDENT,
      sourceId: "sis-student-007",
    });
    const app = buildExportApp(store);
    const res = await app.inject({
      method: "GET",
      url: "/export?from=2026-03-01&to=2026-03-31&format=oneroster",
      headers: ADMIN_H,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json() as {
      results: {
        student: { sourcedId: string };
        class: { sourcedId: string };
      }[];
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.student.sourcedId).toBe("sis-student-007");
    expect(body.results[0]!.class.sourcedId).toBe(SECTION);
  });

  it("is tenant-isolated — a second tenant sees no rows", async () => {
    const store = new MemoryAttendanceStore();
    await seedExport(store, TENANT);
    await seedExport(store, OTHER_TENANT);
    const app = buildExportApp(store);
    const res = await app.inject({
      method: "GET",
      url: "/export?from=2026-03-01&to=2026-03-31",
      headers: {
        "x-tenant-id": OTHER_TENANT.tenantId,
        "x-user-id": ADMIN,
        "x-user-roles": "super_admin",
      },
    });
    expect(res.statusCode).toBe(200);
    // Only OTHER_TENANT's single row, never the demo tenant's.
    const lines = res.body.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(OTHER_TENANT.tenantId);
    expect(res.body).not.toContain(DEMO_TENANT_ID);
  });
});
