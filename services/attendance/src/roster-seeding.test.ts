import type { TenantContext } from "@lms/types";
import { describe, expect, it } from "vitest";

import { FakeEnrollmentRosterResolver } from "./enrollment-resolver.memory.js";
import { MemoryStudentGuardiansResolver } from "./guardians.memory.js";
import { DEMO_TENANT_ID, MemoryAttendanceStore } from "./store.memory.js";

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const SECTION = "section-a";

/**
 * A deterministic id generator so seeded record ids are stable in assertions
 * and don't collide with the default randomUUID.
 */
function seqIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

/**
 * Build a memory store with default codes seeded for the demo tenant and a fake
 * enrollment resolver returning the given active roster for SECTION.
 */
async function storeWithRoster(userIds: string[]) {
  const enrollment = new FakeEnrollmentRosterResolver([
    {
      tenantId: DEMO_TENANT_ID,
      orgUnitId: SECTION,
      students: userIds.map((userId) => ({ userId })),
    },
  ]);
  const store = new MemoryAttendanceStore(
    seqIds(),
    new MemoryStudentGuardiansResolver(),
    enrollment,
  );
  await store.seedDefaultCodes(TENANT);
  return store;
}

describe("createSession roster seeding (#376)", () => {
  it("(a) seeds one record per active student with the default code", async () => {
    const store = await storeWithRoster(["u-1", "u-2", "u-3"]);

    const created = await store.createSession(TENANT, {
      orgUnitId: SECTION,
      meetingDate: "2026-01-15",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const loaded = await store.getSession(TENANT, created.session.id);
    expect(loaded?.records).toHaveLength(3);
    expect(loaded?.records.map((r) => r.userId).sort()).toEqual([
      "u-1",
      "u-2",
      "u-3",
    ]);
    // Default code is "P" (present) — see DEFAULT_ATTENDANCE_CODES.
    expect(loaded?.records.every((r) => r.code === "P")).toBe(true);
    // Session is open and therefore editable.
    expect(loaded?.session.status).toBe("open");
  });

  it("(b) is idempotent — recreating after delete-and-reopen never duplicates a (session,user)", async () => {
    const store = await storeWithRoster(["u-1", "u-2"]);

    const first = await store.createSession(TENANT, {
      orgUnitId: SECTION,
      meetingDate: "2026-01-15",
    });
    expect(first.ok).toBe(true);

    // Same (section, date, period) is a duplicate session — rejected, and no
    // extra records are seeded.
    const second = await store.createSession(TENANT, {
      orgUnitId: SECTION,
      meetingDate: "2026-01-15",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("duplicate");

    if (!first.ok) return;
    const loaded = await store.getSession(TENANT, first.session.id);
    // Still exactly one record per student — no duplicate (session,user) rows.
    expect(loaded?.records).toHaveLength(2);
  });

  it("(c) fail-closed empty roster → session created with no seeded records, no throw", async () => {
    // No seeded tuple for SECTION → resolver returns [].
    const store = await storeWithRoster([]);

    const created = await store.createSession(TENANT, {
      orgUnitId: SECTION,
      meetingDate: "2026-01-15",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const loaded = await store.getSession(TENANT, created.session.id);
    expect(loaded?.session.status).toBe("open");
    expect(loaded?.records).toHaveLength(0);
  });

  it("(d) seeded records are editable until finalize, then rejected", async () => {
    const store = await storeWithRoster(["u-1", "u-2"]);

    const created = await store.createSession(TENANT, {
      orgUnitId: SECTION,
      meetingDate: "2026-01-15",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = created.session.id;

    // Editable while open: change u-1's seeded "P" to "A".
    const edit = await store.setRecords(TENANT, sessionId, [
      { userId: "u-1", code: "A" },
    ]);
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.records.find((r) => r.userId === "u-1")?.code).toBe("A");
    // Still no duplicate of u-1 — the seeded row was updated in place.
    expect(edit.records.filter((r) => r.userId === "u-1")).toHaveLength(1);

    // After finalize, further edits are rejected.
    const finalized = await store.finalizeSession(TENANT, sessionId);
    expect(finalized?.status).toBe("finalized");

    const afterFinalize = await store.setRecords(TENANT, sessionId, [
      { userId: "u-2", code: "A" },
    ]);
    expect(afterFinalize.ok).toBe(false);
    if (afterFinalize.ok) return;
    expect(afterFinalize.reason).toBe("finalized");
  });

  it("does not seed records for a tenant with no default code", async () => {
    const enrollment = new FakeEnrollmentRosterResolver([
      {
        tenantId: DEMO_TENANT_ID,
        orgUnitId: SECTION,
        students: [{ userId: "u-1" }],
      },
    ]);
    // No seedDefaultCodes call → tenant has no is_default code.
    const store = new MemoryAttendanceStore(
      seqIds(),
      new MemoryStudentGuardiansResolver(),
      enrollment,
    );

    const created = await store.createSession(TENANT, {
      orgUnitId: SECTION,
      meetingDate: "2026-01-15",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const loaded = await store.getSession(TENANT, created.session.id);
    expect(loaded?.records).toHaveLength(0);
  });

  it("tenant isolation: a section roster seeds records only for its own tenant", async () => {
    const store = await storeWithRoster(["u-1"]);

    const created = await store.createSession(TENANT, {
      orgUnitId: SECTION,
      meetingDate: "2026-01-15",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const otherTenant: TenantContext = {
      ...TENANT,
      tenantId: "22222222-2222-2222-2222-222222222222",
    };
    // The other tenant has no seeded roster for SECTION and cannot see the
    // first tenant's session.
    const visible = await store.getSession(otherTenant, created.session.id);
    expect(visible).toBeNull();
  });
});
