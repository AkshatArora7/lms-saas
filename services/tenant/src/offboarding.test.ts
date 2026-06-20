import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import {
  PURGE_TARGETS,
  csvCell,
  toOneRosterCsv,
  type AuditEvent,
  type OffboardingPorts,
  type PurgeResult,
} from "./offboarding.js";
import { buildApp } from "./main.js";
import { createSeededMemoryStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";

interface Recorder extends OffboardingPorts {
  audits: AuditEvent[];
}

function fakePorts(opts: { failing?: string[] } = {}): Recorder {
  const audits: AuditEvent[] = [];
  const failing = new Set(opts.failing ?? []);
  return {
    audits,
    async exportRoster() {
      return {
        orgs: [{ sourcedId: "o1", name: "Demo High, North", type: "school" }],
        users: [
          {
            sourcedId: "u1",
            username: "ada",
            givenName: "Ada",
            familyName: "Lovelace",
            email: "ada@demo.edu",
            role: "student",
          },
        ],
        enrollments: [
          { sourcedId: "e1", classSourcedId: "c1", userSourcedId: "u1", role: "student", status: "active" },
        ],
        academicSessions: [
          { sourcedId: "s1", title: "Fall", type: "term", startDate: "2026-09-01", endDate: "2026-12-20" },
        ],
      };
    },
    async exportContent() {
      return [{ id: "p1", type: "page", title: "Welcome", url: "/p1" }];
    },
    async purge(_tenantId, service): Promise<PurgeResult> {
      if (failing.has(service)) return { service, ok: false, error: "unreachable" };
      return { service, ok: true, purged: 1 };
    },
    async audit(_tenantId, event) {
      audits.push(event);
    },
  };
}

function build(ports: OffboardingPorts) {
  return buildApp({
    config,
    store: createSeededMemoryStore(),
    offboardingPorts: ports,
  });
}

describe("OneRoster CSV (pure)", () => {
  it("escapes commas/quotes/newlines per RFC 4180", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });
  it("renders the OneRoster file set with headers", () => {
    const files = toOneRosterCsv({
      orgs: [{ sourcedId: "o1", name: "Demo, North", type: "school" }],
      users: [],
      enrollments: [],
      academicSessions: [],
    });
    expect(Object.keys(files)).toEqual([
      "orgs.csv",
      "users.csv",
      "enrollments.csv",
      "academicSessions.csv",
    ]);
    expect(files["orgs.csv"]).toContain("sourcedId,name,type,parentSourcedId");
    expect(files["orgs.csv"]).toContain('"Demo, North"');
  });
});

describe("tenant offboarding & export (#7)", () => {
  it("exports OneRoster CSV + content archive and audits it", async () => {
    const ports = fakePorts();
    const res = await build(ports).inject({
      method: "GET",
      url: `/tenants/${TENANT_ID}/export?actorId=admin-1`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.oneRoster["users.csv"]).toContain("ada@demo.edu");
    expect(body.contentArchive.count).toBe(1);
    // Audit recorded with the actor.
    expect(ports.audits).toHaveLength(1);
    expect(ports.audits[0]).toMatchObject({
      action: "tenant.data.exported",
      actorId: "admin-1",
      targetId: TENANT_ID,
    });
  });

  it("404s export for an unknown tenant", async () => {
    const res = await build(fakePorts()).inject({
      method: "GET",
      url: `/tenants/${MISSING_ID}/export`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires explicit confirmation to offboard", async () => {
    const res = await build(fakePorts()).inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/offboard`,
      payload: { actorId: "admin-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("purges every service, marks the tenant deleted, and audits it", async () => {
    const ports = fakePorts();
    const app = build(ports);
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/offboard`,
      payload: { confirm: true, actorId: "admin-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allPurged).toBe(true);
    expect(body.purge).toHaveLength(PURGE_TARGETS.length);
    expect(body.status).toBe("deleted");
    expect(ports.audits.at(-1)).toMatchObject({ action: "tenant.data.purged" });

    // The registry now reports the tenant as deleted.
    const after = await app.inject({ method: "GET", url: `/tenants/${TENANT_ID}` });
    expect(after.json().tenant.status).toBe("deleted");
  });

  it("reports unverified purges (207) and does not delete the tenant", async () => {
    const ports = fakePorts({ failing: ["grading", "video"] });
    const app = build(ports);
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/offboard`,
      payload: { confirm: true },
    });
    expect(res.statusCode).toBe(207);
    const body = res.json();
    expect(body.allPurged).toBe(false);
    expect(body.failed).toEqual(expect.arrayContaining(["grading", "video"]));
    expect(body.status).not.toBe("deleted");

    const after = await app.inject({ method: "GET", url: `/tenants/${TENANT_ID}` });
    expect(after.json().tenant.status).toBe("active");
  });
});
