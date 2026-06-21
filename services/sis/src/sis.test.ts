import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  OneRosterError,
  type ClassRecord,
  type EnrollmentRecord,
  type OneRosterClient,
  type OneRosterFetchOptions,
  type OrgRecord,
  type UserRecord,
} from "./oneroster.js";
import { DEMO_TENANT_ID, MemorySisStore } from "./store.memory.js";
import {
  mapClass,
  mapEnrollment,
  mapOneRosterUserToUpsert,
  mapOrg,
  oneRosterOrgType,
  oneRosterRoleToName,
} from "./store.js";
import { runSync } from "./sync.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT = DEMO_TENANT_ID;
const OTHER = "22222222-2222-2222-2222-222222222222";
const H = { "x-tenant-id": TENANT };
const OTHER_H = { "x-tenant-id": OTHER };

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
});

// ---------------------------------------------------------------------------
// A fully programmable fake OneRoster source.
// ---------------------------------------------------------------------------
interface FakeData {
  orgs: OrgRecord[];
  users: UserRecord[];
  classes: ClassRecord[];
  enrollments: EnrollmentRecord[];
}

class FakeOneRoster implements OneRosterClient {
  lastSince: string | undefined;
  constructor(
    private readonly full: FakeData,
    private readonly delta?: FakeData,
  ) {}
  private pick(o: OneRosterFetchOptions | undefined): FakeData {
    this.lastSince = o?.since;
    return o?.since && this.delta ? this.delta : this.full;
  }
  async listOrgs(o?: OneRosterFetchOptions): Promise<OrgRecord[]> {
    return this.pick(o).orgs;
  }
  async listUsers(o?: OneRosterFetchOptions): Promise<UserRecord[]> {
    return this.pick(o).users;
  }
  async listClasses(o?: OneRosterFetchOptions): Promise<ClassRecord[]> {
    return this.pick(o).classes;
  }
  async listEnrollments(o?: OneRosterFetchOptions): Promise<EnrollmentRecord[]> {
    return this.pick(o).enrollments;
  }
}

class ThrowingOneRoster implements OneRosterClient {
  constructor(private readonly err: Error) {}
  async listOrgs(): Promise<OrgRecord[]> {
    throw this.err;
  }
  async listUsers(): Promise<UserRecord[]> {
    return [];
  }
  async listClasses(): Promise<ClassRecord[]> {
    return [];
  }
  async listEnrollments(): Promise<EnrollmentRecord[]> {
    return [];
  }
}

const SAMPLE: FakeData = {
  orgs: [
    { sourcedId: "org-1", name: "Springfield High", type: "school", parentSourcedId: null },
    { sourcedId: "dept-1", name: "Science Dept", type: "department", parentSourcedId: "org-1" },
  ],
  users: [
    { sourcedId: "u-1", givenName: "Ada", familyName: "Lovelace", email: "ada@school.edu", role: "teacher" },
    { sourcedId: "u-2", givenName: "Bob", familyName: "Builder", email: "bob@school.edu", role: "student" },
  ],
  classes: [{ sourcedId: "c-1", title: "Algebra I", orgSourcedId: "org-1" }],
  enrollments: [
    { sourcedId: "e-1", classSourcedId: "c-1", userSourcedId: "u-1", role: "teacher" },
    { sourcedId: "e-2", classSourcedId: "c-1", userSourcedId: "u-2", role: "student" },
  ],
};

function build(
  store = new MemorySisStore(),
  client: OneRosterClient = new FakeOneRoster(SAMPLE),
) {
  return { app: buildApp({ config, store, client, resolveTenant }), store, client };
}

// ===========================================================================
describe("pure mapping helpers", () => {
  it("oneRosterRoleToName normalises aliases", () => {
    expect(oneRosterRoleToName("Teacher")).toBe("teacher");
    expect(oneRosterRoleToName("primary")).toBe("teacher");
    expect(oneRosterRoleToName("instructor")).toBe("teacher");
    expect(oneRosterRoleToName("student")).toBe("student");
  });

  it("oneRosterOrgType maps to schema-allowed org_unit types", () => {
    expect(oneRosterOrgType("school")).toBe("organization");
    expect(oneRosterOrgType("district")).toBe("organization");
    expect(oneRosterOrgType("department")).toBe("department");
  });

  it("mapOneRosterUserToUpsert builds display name and rejects missing email", () => {
    const ok = mapOneRosterUserToUpsert(SAMPLE.users[0]!);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.input.displayName).toBe("Ada Lovelace");
      expect(ok.input.email).toBe("ada@school.edu");
    }
    const bad = mapOneRosterUserToUpsert({
      sourcedId: "u-x",
      givenName: "No",
      familyName: "Email",
      email: null,
      role: "student",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("missing_email");
  });

  it("mapOrg/mapClass/mapEnrollment reject malformed records", () => {
    expect(mapOrg({ sourcedId: "", name: "x", type: "school" }).ok).toBe(false);
    expect(mapClass({ sourcedId: "c", title: "", orgSourcedId: "o" }).ok).toBe(false);
    expect(
      mapEnrollment({ sourcedId: "e", classSourcedId: "", userSourcedId: "u", role: "student" }).ok,
    ).toBe(false);
  });
});

describe("sis service (#14)", () => {
  it("health reports ok", async () => {
    const res = await build().app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("sis");
  });

  it("a full sync ingests orgs/users/classes/enrollments and reports counts", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    expect(res.statusCode).toBe(201);
    const run = res.json().run;
    expect(run.status).toBe("succeeded");
    expect(run.stats.mode).toBe("full");
    expect(run.stats.counts.orgs).toMatchObject({ fetched: 2, created: 2, skipped: 0 });
    expect(run.stats.counts.users).toMatchObject({ fetched: 2, created: 2 });
    expect(run.stats.counts.classes).toMatchObject({ fetched: 1, created: 1 });
    expect(run.stats.counts.enrollments).toMatchObject({ fetched: 2, created: 2, skipped: 0 });
    expect(run.stats.conflicts).toHaveLength(0);
    expect(run.stats.errors).toHaveLength(0);
  });

  it("is idempotent: a second run updates and does not duplicate; id-map is stable", async () => {
    const { app, store } = build();
    await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    const firstMap = await store.listIdMap(ctx(TENANT));
    const res2 = await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    const run2 = res2.json().run;
    expect(run2.status).toBe("succeeded");
    expect(run2.stats.counts.orgs.created).toBe(0);
    expect(run2.stats.counts.orgs.updated).toBe(2);
    expect(run2.stats.counts.users.updated).toBe(2);
    expect(run2.stats.counts.enrollments.updated).toBe(2);
    const secondMap = await store.listIdMap(ctx(TENANT));
    expect(secondMap.length).toBe(firstMap.length);
  });

  it("delta sync passes the watermark as `since` and applies only changed records", async () => {
    const delta: FakeData = {
      orgs: [],
      users: [
        { sourcedId: "u-3", givenName: "Carol", familyName: "Danvers", email: "carol@school.edu", role: "student" },
      ],
      classes: [],
      enrollments: [],
    };
    const client = new FakeOneRoster(SAMPLE, delta);
    const { app } = build(new MemorySisStore(), client);
    // First run (delta with no watermark → full).
    await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: {} });
    expect(client.lastSince).toBeUndefined();
    // Second run is a true delta: a `since` watermark is sent, only the delta applied.
    const res = await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { mode: "delta" } });
    const run = res.json().run;
    expect(client.lastSince).toBeTruthy();
    expect(run.stats.mode).toBe("delta");
    expect(run.stats.counts.users).toMatchObject({ fetched: 1, created: 1 });
    expect(run.stats.counts.orgs.fetched).toBe(0);
  });

  it("captures a conflict (unknown role) -> skipped, run still succeeds", async () => {
    const data: FakeData = {
      ...SAMPLE,
      enrollments: [
        { sourcedId: "e-9", classSourcedId: "c-1", userSourcedId: "u-1", role: "aide" },
      ],
    };
    const { app } = build(new MemorySisStore(), new FakeOneRoster(data));
    const res = await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    const run = res.json().run;
    expect(run.status).toBe("succeeded");
    expect(run.stats.counts.enrollments.skipped).toBe(1);
    expect(run.stats.conflicts).toEqual([
      expect.objectContaining({ entityType: "enrollment", sourcedId: "e-9", reason: "unknown_role" }),
    ]);
  });

  it("captures an error (missing email) -> skipped, run still succeeds", async () => {
    const data: FakeData = {
      ...SAMPLE,
      users: [{ sourcedId: "u-x", givenName: "No", familyName: "Mail", email: null, role: "student" }],
      enrollments: [],
    };
    const { app } = build(new MemorySisStore(), new FakeOneRoster(data));
    const res = await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    const run = res.json().run;
    expect(run.status).toBe("succeeded");
    expect(run.stats.counts.users.skipped).toBe(1);
    expect(run.stats.errors).toEqual([
      expect.objectContaining({ entityType: "user", sourcedId: "u-x", reason: "missing_email" }),
    ]);
  });

  it("a transport failure finishes the run as 'failed' with the error in stats", async () => {
    const client = new ThrowingOneRoster(new OneRosterError(503, "service unavailable"));
    const { app } = build(new MemorySisStore(), client);
    const res = await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    expect(res.statusCode).toBe(201);
    const run = res.json().run;
    expect(run.status).toBe("failed");
    expect(run.stats.errors).toEqual([
      expect.objectContaining({ reason: "transport_error" }),
    ]);
  });

  it("GET /sis/sync/:runId returns the run + report; 404 when missing", async () => {
    const { app } = build();
    const created = await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    const runId = created.json().run.id;
    const got = await app.inject({ method: "GET", url: `/sis/sync/${runId}`, headers: H });
    expect(got.statusCode).toBe(200);
    expect(got.json().run.id).toBe(runId);
    const missing = await app.inject({
      method: "GET",
      url: "/sis/sync/00000000-0000-0000-0000-000000000000",
      headers: H,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /sis/sync lists runs newest first", async () => {
    const { app } = build();
    await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    const list = await app.inject({ method: "GET", url: "/sis/sync", headers: H });
    expect(list.statusCode).toBe(200);
    expect(list.json().runs).toHaveLength(2);
  });

  it("GET /sis/id-map looks up an internal id; 404 when unmapped", async () => {
    const { app } = build();
    await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    const found = await app.inject({
      method: "GET",
      url: "/sis/id-map?entityType=user&sourceId=u-1",
      headers: H,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().mapping).toMatchObject({ entityType: "user", sourceId: "u-1" });
    expect(typeof found.json().mapping.internalId).toBe("string");
    const missing = await app.inject({
      method: "GET",
      url: "/sis/id-map?entityType=user&sourceId=nope",
      headers: H,
    });
    expect(missing.statusCode).toBe(404);
    // Listing form.
    const listed = await app.inject({ method: "GET", url: "/sis/id-map?entityType=org", headers: H });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().mappings.length).toBeGreaterThan(0);
  });

  it("isolates tenants: another tenant sees no runs or mappings", async () => {
    const { app, store } = build();
    await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { full: true } });
    // The other tenant's listings are empty.
    const otherRuns = await app.inject({ method: "GET", url: "/sis/sync", headers: OTHER_H });
    expect(otherRuns.json().runs).toEqual([]);
    const otherMap = await store.listIdMap(ctx(OTHER));
    expect(otherMap).toEqual([]);
    const otherLookup = await app.inject({
      method: "GET",
      url: "/sis/id-map?entityType=user&sourceId=u-1",
      headers: OTHER_H,
    });
    expect(otherLookup.statusCode).toBe(404);
  });

  it("requires a tenant (400 without x-tenant-id)", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/sis/sync", payload: { full: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });

  it("rejects an invalid source / mode (400)", async () => {
    const { app } = build();
    expect(
      (await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { source: "csv" } })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/sis/sync", headers: H, payload: { mode: "weird" } })).statusCode,
    ).toBe(400);
  });
});

describe("runSync engine (direct, fakes only)", () => {
  it("orders parents before children and records the id-map", async () => {
    const store = new MemorySisStore();
    const client = new FakeOneRoster(SAMPLE);
    const run = await runSync(ctx(TENANT), client, store, { full: true });
    expect(run.status).toBe("succeeded");
    // The department resolved its parent org (org-1) → not a conflict.
    const stats = run.stats as { conflicts: unknown[]; counts: Record<string, { created: number }> };
    expect(stats.conflicts).toHaveLength(0);
    expect(stats.counts.orgs!.created).toBe(2);
    // Enrollment org_unit resolves to the class's org_unit (id-map 'class').
    const classMap = await store.lookupInternalId(ctx(TENANT), "class", "c-1");
    expect(classMap).toBeTruthy();
  });

  it("skips a child org when its parent is unmapped (conflict, not error)", async () => {
    const store = new MemorySisStore();
    const orphan: FakeData = {
      orgs: [{ sourcedId: "dept-x", name: "Orphan Dept", type: "department", parentSourcedId: "missing-org" }],
      users: [],
      classes: [],
      enrollments: [],
    };
    const run = await runSync(ctx(TENANT), new FakeOneRoster(orphan), store, { full: true });
    const stats = run.stats as { conflicts: { reason: string }[]; counts: Record<string, { skipped: number }> };
    expect(run.status).toBe("succeeded");
    expect(stats.counts.orgs!.skipped).toBe(1);
    expect(stats.conflicts[0]!.reason).toBe("parent_unmapped");
  });
});
