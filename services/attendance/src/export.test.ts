import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_CSV_HEADER,
  canExportAttendance,
  COMPLIANCE_ROLE,
  ORG_ADMIN_ROLE,
  SUPER_ADMIN_ROLE,
  toCsv,
  toOneRoster,
  type OneRosterIdMap,
} from "./export.js";
import type { AttendanceExportRow } from "./store.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

function row(overrides: Partial<AttendanceExportRow> = {}): AttendanceExportRow {
  return {
    tenantId: TENANT,
    sessionId: "session-1",
    orgUnitId: "section-a",
    meetingDate: "2026-03-01",
    periodLabel: "Period 1",
    userId: "user-1",
    code: "A",
    category: "absent",
    minutesLate: null,
    comment: null,
    ...overrides,
  };
}

describe("canExportAttendance — role gate (#377)", () => {
  it("allows super_admin, org_admin, compliance_officer", () => {
    expect(canExportAttendance([SUPER_ADMIN_ROLE])).toBe(true);
    expect(canExportAttendance([ORG_ADMIN_ROLE])).toBe(true);
    expect(canExportAttendance([COMPLIANCE_ROLE])).toBe(true);
    expect(canExportAttendance(["learner", ORG_ADMIN_ROLE])).toBe(true);
  });

  it("denies non-admin roles and empty roles", () => {
    expect(canExportAttendance([])).toBe(false);
    expect(canExportAttendance(["learner", "instructor"])).toBe(false);
  });
});

describe("toCsv — stable header + RFC-4180 (#377)", () => {
  it("emits the exact stable header even for zero rows", () => {
    expect(toCsv([])).toBe(ATTENDANCE_CSV_HEADER);
    expect(ATTENDANCE_CSV_HEADER).toBe(
      "tenant_id,section_id,meeting_date,period_label,student_id,code,category,minutes_late,comment",
    );
  });

  it("serializes a row in the fixed column order with empty strings for nulls", () => {
    const csv = toCsv([row()]);
    const [header, line] = csv.split("\r\n");
    expect(header).toBe(ATTENDANCE_CSV_HEADER);
    expect(line).toBe(
      `${TENANT},section-a,2026-03-01,Period 1,user-1,A,absent,,`,
    );
  });

  it("quotes fields containing commas, quotes, or newlines and doubles quotes", () => {
    const csv = toCsv([
      row({
        comment: 'late, again "really"',
        periodLabel: "AM\nblock",
        minutesLate: 5,
      }),
    ]);
    const line = csv.split("\r\n")[1]!;
    expect(line).toContain('"late, again ""really"""');
    expect(line).toContain('"AM\nblock"');
    // minutesLate is a plain number, no quoting.
    expect(line).toContain(",5,");
  });

  it("uses CRLF line endings between records", () => {
    const csv = toCsv([row({ userId: "u1" }), row({ userId: "u2" })]);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});

describe("toOneRoster — sis_id_map mapping + uuid fallback (#377)", () => {
  const idMap: OneRosterIdMap = {
    user: new Map([["user-1", "sis-user-1"]]),
    class: new Map([["section-a", "sis-class-a"]]),
  };

  it("maps student/class sourcedIds from the id map and builds hrefs", () => {
    const { results } = toOneRoster([row()], idMap);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.sourcedId).toBe("session-1:user-1");
    expect(r.status).toBe("active");
    expect(r.scoreDate).toBe("2026-03-01");
    expect(r.dateLastModified).toBe("2026-03-01");
    expect(r.metadata).toEqual({ code: "A", category: "absent", minutesLate: null });
    expect(r.student).toEqual({
      sourcedId: "sis-user-1",
      href: "/users/sis-user-1",
      type: "user",
    });
    expect(r.class).toEqual({
      sourcedId: "sis-class-a",
      href: "/classes/sis-class-a",
      type: "class",
    });
  });

  it("falls back to the internal uuid when a tenant is not SIS-synced", () => {
    const empty: OneRosterIdMap = { user: new Map(), class: new Map() };
    const { results } = toOneRoster([row()], empty);
    const r = results[0]!;
    expect(r.student.sourcedId).toBe("user-1");
    expect(r.student.href).toBe("/users/user-1");
    expect(r.class.sourcedId).toBe("section-a");
    expect(r.class.href).toBe("/classes/section-a");
  });

  it("carries comment and minutesLate through metadata/comment", () => {
    const { results } = toOneRoster(
      [row({ comment: "doctor note", minutesLate: 12 })],
      idMap,
    );
    const r = results[0]!;
    expect(r.comment).toBe("doctor note");
    expect(r.metadata.minutesLate).toBe(12);
  });
});
