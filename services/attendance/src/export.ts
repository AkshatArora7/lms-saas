import type { StandardRole } from "@lms/types";

import type { AttendanceCategory, AttendanceExportRow } from "./store.js";

// ----------------------------------------------------------------------------
// Role gating (#377)
// ----------------------------------------------------------------------------
// Reuse the trusted caller roles already resolved from `x-user-roles`
// (main.ts:81-97). The admin personas are part of the closed `StandardRole`
// union in @lms/types, so typing them ties the constants to that single source
// of truth (mirrors analytics/src/store.ts:540-549).

/** Tenant-wide admin persona that may export attendance for compliance/SIS. */
export const SUPER_ADMIN_ROLE: StandardRole = "super_admin";
/** Org-scoped admin persona — also permitted to export (tenant-wide via RLS). */
export const ORG_ADMIN_ROLE: StandardRole = "org_admin";
/**
 * Compliance persona. NOT yet a member of `StandardRole` — there is no
 * canonical compliance role string issued anywhere in the codebase today. We
 * allow it forward-compatibly (so the moment product/security mint the role it
 * just works) but keep it a bare string, not a typed `StandardRole`, to avoid
 * inventing a brittle role no gateway issues. Pending product confirmation; see
 * the handshake §6 open question.
 */
export const COMPLIANCE_ROLE = "compliance_officer";

/** Roles allowed to export attendance: tenant/org admins + (future) compliance. */
const EXPORT_ROLES: readonly string[] = [
  SUPER_ADMIN_ROLE,
  ORG_ADMIN_ROLE,
  COMPLIANCE_ROLE,
];

/** True when any of the caller's roles is permitted to run an export (#377). */
export function canExportAttendance(roles: readonly string[]): boolean {
  return roles.some((r) => EXPORT_ROLES.includes(r));
}

// ----------------------------------------------------------------------------
// CSV (RFC-4180)
// ----------------------------------------------------------------------------

/**
 * STABLE CSV header — exact column order. NEVER reorder or rename: downstream
 * SIS/compliance importers pin to these positions/names.
 */
export const ATTENDANCE_CSV_HEADER =
  "tenant_id,section_id,meeting_date,period_label,student_id,code,category,minutes_late,comment,participation_score,participation_note";

/** RFC-4180 quote a single field: wrap in quotes iff it contains `,` `"` or a newline; double embedded quotes. */
function csvField(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize export rows to RFC-4180 CSV with the stable header. The header is
 * ALWAYS emitted, even for zero rows, so an empty export is still a valid file.
 * Pure (no I/O) so it is unit-tested without HTTP.
 */
export function toCsv(rows: readonly AttendanceExportRow[]): string {
  const lines = [ATTENDANCE_CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.tenantId),
        csvField(row.orgUnitId),
        csvField(row.meetingDate),
        csvField(row.periodLabel),
        csvField(row.userId),
        csvField(row.code),
        csvField(row.category),
        csvField(row.minutesLate),
        csvField(row.comment),
        csvField(row.participationScore),
        csvField(row.participationNote),
      ].join(","),
    );
  }
  // RFC-4180 lines are CRLF-terminated; trailing CRLF on the last record is allowed.
  return lines.join("\r\n");
}

// ----------------------------------------------------------------------------
// OneRoster (v1.1 Results-aligned)
// ----------------------------------------------------------------------------

export interface OneRosterRef {
  sourcedId: string;
  href: string;
  type: "user" | "class";
}

/** A OneRoster-aligned attendance result (field names from the OneRoster v1.1 spec). */
export interface OneRosterResult {
  sourcedId: string;
  status: "active";
  dateLastModified: string;
  metadata: {
    code: string;
    category: AttendanceCategory;
    minutesLate: number | null;
    participationScore: number | null;
    participationNote: string | null;
  };
  student: OneRosterRef;
  class: OneRosterRef;
  scoreDate: string;
  comment: string | null;
}

/** sourcedId lookups resolved from `sis_id_map` (internal uuid -> external sourcedId). */
export interface OneRosterIdMap {
  /** entity_type='user' map, keyed by internal app_user id. */
  user: ReadonlyMap<string, string>;
  /** entity_type='class' map, keyed by internal org_unit id. */
  class: ReadonlyMap<string, string>;
}

/**
 * Map export rows to OneRoster results. sourcedIds come from `sis_id_map`
 * (entity_type 'user'/'class'); when a tenant is not SIS-synced we FALL BACK to
 * the internal uuid so the export is still usable (never blank). Pure (no I/O).
 */
export function toOneRoster(
  rows: readonly AttendanceExportRow[],
  idMap: OneRosterIdMap,
): { results: OneRosterResult[] } {
  const results = rows.map((row): OneRosterResult => {
    const studentSourcedId = idMap.user.get(row.userId) ?? row.userId;
    const classSourcedId = idMap.class.get(row.orgUnitId) ?? row.orgUnitId;
    return {
      sourcedId: `${row.sessionId}:${row.userId}`,
      status: "active",
      dateLastModified: row.meetingDate,
      metadata: {
        code: row.code,
        category: row.category,
        minutesLate: row.minutesLate,
        participationScore: row.participationScore,
        participationNote: row.participationNote,
      },
      student: {
        sourcedId: studentSourcedId,
        href: `/users/${studentSourcedId}`,
        type: "user",
      },
      class: {
        sourcedId: classSourcedId,
        href: `/classes/${classSourcedId}`,
        type: "class",
      },
      scoreDate: row.meetingDate,
      comment: row.comment,
    };
  });
  return { results };
}
