import { randomUUID } from "node:crypto";

import { withTenant } from "@lms/db";

import { attendanceEvent } from "./events.js";
import {
  DEFAULT_ATTENDANCE_CODES,
  type AttendanceCategory,
  type AttendanceCodeRecord,
  type AttendanceHistoryEntry,
  type AttendanceRecordRecord,
  type AttendanceSessionRecord,
  type AttendanceStore,
  type CreateSessionResult,
  type NewAttendanceCodeInput,
  type NewSessionInput,
  type RecordInput,
  type SetRecordsResult,
  type StudentAttendanceSummary,
} from "./store.js";

interface CodeRow {
  tenant_id: string;
  code: string;
  label: string;
  category: AttendanceCategory;
  is_default: boolean;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  org_unit_id: string;
  timetable_entry_id: string | null;
  meeting_date: Date | string;
  period_label: string | null;
  status: "open" | "finalized";
  taken_by: string | null;
}

interface RecordRow {
  id: string;
  tenant_id: string;
  session_id: string;
  user_id: string;
  code: string;
  minutes_late: number | null;
  comment: string | null;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function toCode(row: CodeRow): AttendanceCodeRecord {
  return {
    tenantId: row.tenant_id,
    code: row.code,
    label: row.label,
    category: row.category,
    isDefault: row.is_default,
  };
}

function toSession(row: SessionRow): AttendanceSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orgUnitId: row.org_unit_id,
    timetableEntryId: row.timetable_entry_id,
    meetingDate: isoDate(row.meeting_date),
    periodLabel: row.period_label,
    status: row.status,
    takenBy: row.taken_by,
  };
}

function toRecord(row: RecordRow): AttendanceRecordRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    userId: row.user_id,
    code: row.code,
    minutesLate: row.minutes_late,
    comment: row.comment,
  };
}

const SESSION_COLUMNS = `id, tenant_id, org_unit_id, timetable_entry_id, meeting_date, period_label, status, taken_by`;
const RECORD_COLUMNS = `id, tenant_id, session_id, user_id, code, minutes_late, comment`;

/**
 * Postgres-backed attendance store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants.
 */
export function createPrismaStore(
  generateId: () => string = randomUUID,
): AttendanceStore {
  return {
    async listCodes(ctx) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CodeRow[]>(
          `SELECT tenant_id, code, label, category, is_default
             FROM attendance_code ORDER BY code`,
        );
        return rows.map(toCode);
      });
    },

    async upsertCode(ctx, input: NewAttendanceCodeInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CodeRow[]>(
          `INSERT INTO attendance_code (tenant_id, code, label, category, is_default)
           VALUES ($1::uuid, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, code)
           DO UPDATE SET label = EXCLUDED.label,
                         category = EXCLUDED.category,
                         is_default = EXCLUDED.is_default
           RETURNING tenant_id, code, label, category, is_default`,
          ctx.tenantId,
          input.code,
          input.label,
          input.category,
          input.isDefault ?? false,
        );
        return toCode(rows[0]!);
      });
    },

    async seedDefaultCodes(ctx) {
      return withTenant(ctx, async (db) => {
        for (const c of DEFAULT_ATTENDANCE_CODES) {
          await db.$executeRawUnsafe(
            `INSERT INTO attendance_code (tenant_id, code, label, category, is_default)
             VALUES ($1::uuid, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, code) DO NOTHING`,
            ctx.tenantId,
            c.code,
            c.label,
            c.category,
            c.isDefault ?? false,
          );
        }
        const rows = await db.$queryRawUnsafe<CodeRow[]>(
          `SELECT tenant_id, code, label, category, is_default
             FROM attendance_code ORDER BY code`,
        );
        return rows.map(toCode);
      });
    },

    async createSession(ctx, input: NewSessionInput) {
      return withTenant<CreateSessionResult>(ctx, async (db) => {
        const periodLabel = input.periodLabel ?? null;
        const existing = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM attendance_session
             WHERE org_unit_id = $1::uuid AND meeting_date = $2
               AND period_label IS NOT DISTINCT FROM $3
             LIMIT 1`,
          input.orgUnitId,
          input.meetingDate,
          periodLabel,
        );
        if (existing.length > 0) return { ok: false, reason: "duplicate" };

        const rows = await db.$queryRawUnsafe<SessionRow[]>(
          `INSERT INTO attendance_session
             (id, tenant_id, org_unit_id, timetable_entry_id, meeting_date,
              period_label, taken_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid)
           RETURNING ${SESSION_COLUMNS}`,
          generateId(),
          ctx.tenantId,
          input.orgUnitId,
          input.timetableEntryId ?? null,
          input.meetingDate,
          periodLabel,
          input.takenBy ?? null,
        );
        return { ok: true, session: toSession(rows[0]!) };
      });
    },

    async getSession(ctx, id) {
      return withTenant(ctx, async (db) => {
        const sessions = await db.$queryRawUnsafe<SessionRow[]>(
          `SELECT ${SESSION_COLUMNS} FROM attendance_session WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        const session = sessions[0];
        if (!session) return null;
        const records = await db.$queryRawUnsafe<RecordRow[]>(
          `SELECT ${RECORD_COLUMNS} FROM attendance_record WHERE session_id = $1::uuid`,
          id,
        );
        return { session: toSession(session), records: records.map(toRecord) };
      });
    },

    async setRecords(ctx, sessionId, records: RecordInput[]) {
      return withTenant<SetRecordsResult>(ctx, async (db) => {
        const sessions = await db.$queryRawUnsafe<SessionRow[]>(
          `SELECT ${SESSION_COLUMNS} FROM attendance_session WHERE id = $1::uuid LIMIT 1`,
          sessionId,
        );
        const session = sessions[0];
        if (!session || session.status === "finalized") {
          return { ok: false, reason: "finalized" };
        }

        const codeRows = await db.$queryRawUnsafe<{ code: string }[]>(
          `SELECT code FROM attendance_code`,
        );
        const known = new Set(codeRows.map((c) => c.code));
        if (records.some((r) => !known.has(r.code))) {
          return { ok: false, reason: "unknown_code" };
        }

        for (const r of records) {
          await db.$executeRawUnsafe(
            `INSERT INTO attendance_record
               (id, tenant_id, session_id, user_id, code, minutes_late, comment)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)
             ON CONFLICT (session_id, user_id)
             DO UPDATE SET code = EXCLUDED.code,
                           minutes_late = EXCLUDED.minutes_late,
                           comment = EXCLUDED.comment`,
            generateId(),
            ctx.tenantId,
            sessionId,
            r.userId,
            r.code,
            r.minutesLate ?? null,
            r.comment ?? null,
          );
        }

        const updated = await db.$queryRawUnsafe<RecordRow[]>(
          `SELECT ${RECORD_COLUMNS} FROM attendance_record WHERE session_id = $1::uuid`,
          sessionId,
        );
        return { ok: true, records: updated.map(toRecord) };
      });
    },

    async finalizeSession(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<SessionRow[]>(
          `UPDATE attendance_session SET status = 'finalized'
             WHERE id = $1::uuid
           RETURNING ${SESSION_COLUMNS}`,
          id,
        );
        const row = rows[0];
        if (!row) return null;

        // Emit an outbox event for each absent/tardy record so the relay ->
        // notification path informs the learner (preferences applied there).
        const flagged = await db.$queryRawUnsafe<
          { user_id: string; code: string; category: "absent" | "tardy" }[]
        >(
          `SELECT r.user_id, r.code, c.category
             FROM attendance_record r
             JOIN attendance_code c
               ON c.tenant_id = r.tenant_id AND c.code = r.code
            WHERE r.session_id = $1::uuid AND c.category IN ('absent','tardy')`,
          id,
        );
        for (const r of flagged) {
          const event = attendanceEvent(id, row.org_unit_id, {
            userId: r.user_id,
            code: r.code,
            category: r.category,
          });
          await db.$executeRawUnsafe(
            `INSERT INTO event_outbox (tenant_id, type, org_unit_id, payload)
             VALUES ($1::uuid, $2, $3::uuid, $4::jsonb)`,
            ctx.tenantId,
            event.type,
            row.org_unit_id,
            JSON.stringify(event.payload),
          );
        }
        return toSession(row);
      });
    },

    async sectionSummary(ctx, orgUnitId, chronicAbsenceThreshold) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<
          { user_id: string; category: AttendanceCategory; n: bigint }[]
        >(
          `SELECT r.user_id, c.category, COUNT(*)::bigint AS n
             FROM attendance_record r
             JOIN attendance_session s ON s.id = r.session_id
             JOIN attendance_code c
               ON c.tenant_id = r.tenant_id AND c.code = r.code
            WHERE s.org_unit_id = $1::uuid
            GROUP BY r.user_id, c.category`,
          orgUnitId,
        );

        const byUser = new Map<string, StudentAttendanceSummary>();
        for (const row of rows) {
          let s = byUser.get(row.user_id);
          if (!s) {
            s = {
              userId: row.user_id,
              total: 0,
              present: 0,
              absent: 0,
              tardy: 0,
              excused: 0,
              absenceRate: 0,
              chronicAbsence: false,
            };
            byUser.set(row.user_id, s);
          }
          const n = Number(row.n);
          s.total += n;
          s[row.category] += n;
        }

        const students = [...byUser.values()].map((s) => {
          const absenceRate = s.total > 0 ? s.absent / s.total : 0;
          return {
            ...s,
            absenceRate,
            chronicAbsence: absenceRate >= chronicAbsenceThreshold,
          };
        });

        return { orgUnitId, chronicAbsenceThreshold, students };
      });
    },

    async userHistory(ctx, userId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<
          {
            session_id: string;
            org_unit_id: string;
            meeting_date: Date | string;
            period_label: string | null;
            code: string;
            category: AttendanceCategory;
            minutes_late: number | null;
          }[]
        >(
          `SELECT r.session_id, s.org_unit_id, s.meeting_date, s.period_label,
                  r.code, c.category, r.minutes_late
             FROM attendance_record r
             JOIN attendance_session s ON s.id = r.session_id
             JOIN attendance_code c
               ON c.tenant_id = r.tenant_id AND c.code = r.code
            WHERE r.user_id = $1::uuid
            ORDER BY s.meeting_date DESC`,
          userId,
        );
        return rows.map(
          (row): AttendanceHistoryEntry => ({
            sessionId: row.session_id,
            orgUnitId: row.org_unit_id,
            meetingDate: isoDate(row.meeting_date),
            periodLabel: row.period_label,
            code: row.code,
            category: row.category,
            minutesLate: row.minutes_late,
          }),
        );
      });
    },
  };
}
