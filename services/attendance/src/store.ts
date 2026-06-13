import type { TenantContext } from "@lms/types";

export type AttendanceCategory = "present" | "absent" | "tardy" | "excused";

/** A per-tenant attendance code (e.g. 'P' -> present). */
export interface AttendanceCodeRecord {
  tenantId: string;
  code: string;
  label: string;
  category: AttendanceCategory;
  isDefault: boolean;
}

export type SessionStatus = "open" | "finalized";

/** One attendance-taking event for a section on a date/period. */
export interface AttendanceSessionRecord {
  id: string;
  tenantId: string;
  orgUnitId: string;
  timetableEntryId: string | null;
  meetingDate: string;
  periodLabel: string | null;
  status: SessionStatus;
  takenBy: string | null;
}

/** A single student's status within a session. */
export interface AttendanceRecordRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  userId: string;
  code: string;
  minutesLate: number | null;
  comment: string | null;
}

export interface NewAttendanceCodeInput {
  code: string;
  label: string;
  category: AttendanceCategory;
  isDefault?: boolean;
}

export interface NewSessionInput {
  orgUnitId: string;
  meetingDate: string;
  periodLabel?: string | null;
  timetableEntryId?: string | null;
  takenBy?: string | null;
}

export interface RecordInput {
  userId: string;
  code: string;
  minutesLate?: number | null;
  comment?: string | null;
}

export type CreateSessionResult =
  | { ok: true; session: AttendanceSessionRecord }
  | { ok: false; reason: "duplicate" };

export type SetRecordsResult =
  | { ok: true; records: AttendanceRecordRecord[] }
  | { ok: false; reason: "finalized" | "unknown_code" };

/** Per-student attendance rollup for a section. */
export interface StudentAttendanceSummary {
  userId: string;
  total: number;
  present: number;
  absent: number;
  tardy: number;
  excused: number;
  absenceRate: number;
  chronicAbsence: boolean;
}

export interface SectionAttendanceSummary {
  orgUnitId: string;
  chronicAbsenceThreshold: number;
  students: StudentAttendanceSummary[];
}

/** A student's attendance history entry (record joined with its session). */
export interface AttendanceHistoryEntry {
  sessionId: string;
  orgUnitId: string;
  meetingDate: string;
  periodLabel: string | null;
  code: string;
  category: AttendanceCategory;
  minutesLate: number | null;
}

/**
 * Persistence boundary for the attendance service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the course and calendar services.
 */
export interface AttendanceStore {
  listCodes(ctx: TenantContext): Promise<AttendanceCodeRecord[]>;

  upsertCode(
    ctx: TenantContext,
    input: NewAttendanceCodeInput,
  ): Promise<AttendanceCodeRecord>;

  /** Seed the standard P/A/T/EX vocabulary; returns the resulting codes. */
  seedDefaultCodes(ctx: TenantContext): Promise<AttendanceCodeRecord[]>;

  createSession(
    ctx: TenantContext,
    input: NewSessionInput,
  ): Promise<CreateSessionResult>;

  getSession(
    ctx: TenantContext,
    id: string,
  ): Promise<{
    session: AttendanceSessionRecord;
    records: AttendanceRecordRecord[];
  } | null>;

  /** Upsert per-student records for a session; rejects if already finalized. */
  setRecords(
    ctx: TenantContext,
    sessionId: string,
    records: RecordInput[],
  ): Promise<SetRecordsResult>;

  finalizeSession(
    ctx: TenantContext,
    id: string,
  ): Promise<AttendanceSessionRecord | null>;

  sectionSummary(
    ctx: TenantContext,
    orgUnitId: string,
    chronicAbsenceThreshold: number,
  ): Promise<SectionAttendanceSummary>;

  userHistory(
    ctx: TenantContext,
    userId: string,
  ): Promise<AttendanceHistoryEntry[]>;
}

/** The standard attendance vocabulary seeded for a new tenant. */
export const DEFAULT_ATTENDANCE_CODES: readonly NewAttendanceCodeInput[] = [
  { code: "P", label: "Present", category: "present", isDefault: true },
  { code: "A", label: "Absent", category: "absent" },
  { code: "T", label: "Tardy", category: "tardy" },
  { code: "EX", label: "Excused", category: "excused" },
];
