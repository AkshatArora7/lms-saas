import type { TenantContext } from "@lms/types";

/** A named period within a bell schedule (e.g. "Period 1", 08:30–09:20). */
export interface SchedulePeriodRecord {
  id: string;
  tenantId: string;
  bellScheduleId: string;
  name: string;
  sortOrder: number;
  startTime: string;
  endTime: string;
  dayPattern: string;
}

/** A bell schedule: the rhythm of a school day for an org unit, with periods. */
export interface BellScheduleRecord {
  id: string;
  tenantId: string;
  orgUnitId: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  periods: SchedulePeriodRecord[];
}

/** A recurring class meeting: a section meets in a period/room/day with a teacher. */
export interface TimetableEntryRecord {
  id: string;
  tenantId: string;
  orgUnitId: string;
  periodId: string;
  academicSessionId: string | null;
  instructorId: string | null;
  room: string | null;
  dayOfWeek: number | null;
}

export interface NewSchedulePeriodInput {
  name: string;
  sortOrder?: number;
  startTime: string;
  endTime: string;
  dayPattern?: string;
}

export interface NewBellScheduleInput {
  orgUnitId: string;
  name: string;
  timezone?: string;
  isDefault?: boolean;
  periods: NewSchedulePeriodInput[];
}

export interface NewTimetableEntryInput {
  orgUnitId: string;
  periodId: string;
  academicSessionId?: string | null;
  instructorId?: string | null;
  room?: string | null;
  dayOfWeek?: number | null;
}

/**
 * Why a timetable entry was rejected:
 * - `slot`       — the section already meets in this period on this day
 * - `room`       — the room is already booked for this period/day
 * - `instructor` — the teacher is already teaching in this period/day
 */
export type TimetableConflict = "slot" | "room" | "instructor";

export type CreateTimetableResult =
  | { ok: true; entry: TimetableEntryRecord }
  | { ok: false; conflict: TimetableConflict };

/**
 * Persistence boundary for the calendar service's scheduling surface. Routes
 * depend only on this interface, so production uses an RLS-scoped Postgres
 * implementation while tests inject an in-memory one — mirroring the course and
 * identity services.
 */
export interface SchedulingStore {
  listBellSchedules(
    ctx: TenantContext,
    orgUnitId?: string,
  ): Promise<BellScheduleRecord[]>;

  getBellSchedule(
    ctx: TenantContext,
    id: string,
  ): Promise<BellScheduleRecord | null>;

  createBellSchedule(
    ctx: TenantContext,
    input: NewBellScheduleInput,
  ): Promise<BellScheduleRecord>;

  /** Create a timetable entry, rejecting room/teacher/period conflicts. */
  createTimetableEntry(
    ctx: TenantContext,
    input: NewTimetableEntryInput,
  ): Promise<CreateTimetableResult>;

  /** Personal recurring weekly timetable for an instructor. */
  listTimetableForInstructor(
    ctx: TenantContext,
    instructorId: string,
  ): Promise<TimetableEntryRecord[]>;

  /** All timetable entries for an org unit (section/school). */
  listTimetableForOrgUnit(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<TimetableEntryRecord[]>;
}
