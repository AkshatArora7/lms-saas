import { randomUUID } from "node:crypto";

import { withTenant } from "@lms/db";

import type {
  BellScheduleRecord,
  CreateTimetableResult,
  NewBellScheduleInput,
  NewTimetableEntryInput,
  SchedulePeriodRecord,
  SchedulingStore,
  TimetableEntryRecord,
} from "./store.js";

interface BellScheduleRow {
  id: string;
  tenant_id: string;
  org_unit_id: string;
  name: string;
  timezone: string;
  is_default: boolean;
}

interface PeriodRow {
  id: string;
  tenant_id: string;
  bell_schedule_id: string;
  name: string;
  sort_order: number;
  start_time: string;
  end_time: string;
  day_pattern: string;
}

interface TimetableRow {
  id: string;
  tenant_id: string;
  org_unit_id: string;
  period_id: string;
  academic_session_id: string | null;
  instructor_id: string | null;
  room: string | null;
  day_of_week: number | null;
}

function toPeriod(row: PeriodRow): SchedulePeriodRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    bellScheduleId: row.bell_schedule_id,
    name: row.name,
    sortOrder: row.sort_order,
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    dayPattern: row.day_pattern,
  };
}

function toSchedule(
  row: BellScheduleRow,
  periods: PeriodRow[],
): BellScheduleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orgUnitId: row.org_unit_id,
    name: row.name,
    timezone: row.timezone,
    isDefault: row.is_default,
    periods: periods
      .filter((p) => p.bell_schedule_id === row.id)
      .map(toPeriod),
  };
}

function toEntry(row: TimetableRow): TimetableEntryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orgUnitId: row.org_unit_id,
    periodId: row.period_id,
    academicSessionId: row.academic_session_id,
    instructorId: row.instructor_id,
    room: row.room,
    dayOfWeek: row.day_of_week,
  };
}

const ENTRY_COLUMNS = `id, tenant_id, org_unit_id, period_id, academic_session_id, instructor_id, room, day_of_week`;

/**
 * Postgres-backed scheduling store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants. Room/teacher/
 * period conflicts are checked in the same transaction before insert.
 */
export function createPrismaStore(
  generateId: () => string = randomUUID,
): SchedulingStore {
  return {
    async listBellSchedules(ctx, orgUnitId) {
      return withTenant(ctx, async (db) => {
        const schedules = orgUnitId
          ? await db.$queryRawUnsafe<BellScheduleRow[]>(
              `SELECT id, tenant_id, org_unit_id, name, timezone, is_default
                 FROM bell_schedule WHERE org_unit_id = $1::uuid ORDER BY name`,
              orgUnitId,
            )
          : await db.$queryRawUnsafe<BellScheduleRow[]>(
              `SELECT id, tenant_id, org_unit_id, name, timezone, is_default
                 FROM bell_schedule ORDER BY name`,
            );
        if (schedules.length === 0) return [];
        const periods = await db.$queryRawUnsafe<PeriodRow[]>(
          `SELECT id, tenant_id, bell_schedule_id, name, sort_order,
                  start_time, end_time, day_pattern
             FROM schedule_period ORDER BY sort_order`,
        );
        return schedules.map((s) => toSchedule(s, periods));
      });
    },

    async getBellSchedule(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<BellScheduleRow[]>(
          `SELECT id, tenant_id, org_unit_id, name, timezone, is_default
             FROM bell_schedule WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        const row = rows[0];
        if (!row) return null;
        const periods = await db.$queryRawUnsafe<PeriodRow[]>(
          `SELECT id, tenant_id, bell_schedule_id, name, sort_order,
                  start_time, end_time, day_pattern
             FROM schedule_period WHERE bell_schedule_id = $1::uuid ORDER BY sort_order`,
          id,
        );
        return toSchedule(row, periods);
      });
    },

    async createBellSchedule(ctx, input: NewBellScheduleInput) {
      return withTenant(ctx, async (db) => {
        const bellScheduleId = generateId();
        const scheduleRows = await db.$queryRawUnsafe<BellScheduleRow[]>(
          `INSERT INTO bell_schedule
             (id, tenant_id, org_unit_id, name, timezone, is_default)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
           RETURNING id, tenant_id, org_unit_id, name, timezone, is_default`,
          bellScheduleId,
          ctx.tenantId,
          input.orgUnitId,
          input.name,
          input.timezone ?? "UTC",
          input.isDefault ?? false,
        );
        const periodRows: PeriodRow[] = [];
        for (let i = 0; i < input.periods.length; i += 1) {
          const p = input.periods[i]!;
          const inserted = await db.$queryRawUnsafe<PeriodRow[]>(
            `INSERT INTO schedule_period
               (tenant_id, bell_schedule_id, name, sort_order,
                start_time, end_time, day_pattern)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
             RETURNING id, tenant_id, bell_schedule_id, name, sort_order,
                       start_time, end_time, day_pattern`,
            ctx.tenantId,
            bellScheduleId,
            p.name,
            p.sortOrder ?? i,
            p.startTime,
            p.endTime,
            p.dayPattern ?? "daily",
          );
          periodRows.push(inserted[0]!);
        }
        return toSchedule(scheduleRows[0]!, periodRows);
      });
    },

    async createTimetableEntry(ctx, input: NewTimetableEntryInput) {
      return withTenant<CreateTimetableResult>(ctx, async (db) => {
        const dayOfWeek = input.dayOfWeek ?? null;
        // All entries already booked in this period on this day.
        const existing = await db.$queryRawUnsafe<TimetableRow[]>(
          `SELECT ${ENTRY_COLUMNS} FROM timetable_entry
             WHERE period_id = $1::uuid AND day_of_week IS NOT DISTINCT FROM $2`,
          input.periodId,
          dayOfWeek,
        );

        if (existing.some((e) => e.org_unit_id === input.orgUnitId)) {
          return { ok: false, conflict: "slot" };
        }
        if (
          input.room != null &&
          existing.some((e) => e.room != null && e.room === input.room)
        ) {
          return { ok: false, conflict: "room" };
        }
        if (
          input.instructorId != null &&
          existing.some((e) => e.instructor_id === input.instructorId)
        ) {
          return { ok: false, conflict: "instructor" };
        }

        const rows = await db.$queryRawUnsafe<TimetableRow[]>(
          `INSERT INTO timetable_entry
             (tenant_id, org_unit_id, period_id, academic_session_id,
              instructor_id, room, day_of_week)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7)
           RETURNING ${ENTRY_COLUMNS}`,
          ctx.tenantId,
          input.orgUnitId,
          input.periodId,
          input.academicSessionId ?? null,
          input.instructorId ?? null,
          input.room ?? null,
          dayOfWeek,
        );
        return { ok: true, entry: toEntry(rows[0]!) };
      });
    },

    async listTimetableForInstructor(ctx, instructorId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<TimetableRow[]>(
          `SELECT ${ENTRY_COLUMNS} FROM timetable_entry
             WHERE instructor_id = $1::uuid ORDER BY day_of_week, period_id`,
          instructorId,
        );
        return rows.map(toEntry);
      });
    },

    async listTimetableForOrgUnit(ctx, orgUnitId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<TimetableRow[]>(
          `SELECT ${ENTRY_COLUMNS} FROM timetable_entry
             WHERE org_unit_id = $1::uuid ORDER BY day_of_week, period_id`,
          orgUnitId,
        );
        return rows.map(toEntry);
      });
    },
  };
}
