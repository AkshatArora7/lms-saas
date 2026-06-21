import { withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

import {
  aggregateEvents,
  buildCourseEngagement,
  ratePct,
  round1,
  type AggregateDimension,
  type AnalyticsStore,
  type CaliperEventRecord,
  type CourseEngagementResult,
  type DeidentifiedAggregate,
  type EngagementSourceData,
  type EventFilter,
  type NewCaliperEventInput,
  type NewXapiStatementInput,
  type OrgUnitRollup,
  type XapiStatementRecord,
} from "./store.js";

interface CaliperRow {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  type: string;
  action: string;
  object_type: string;
  object_id: string;
  org_unit_id: string | null;
  event_time: Date | string;
  envelope: unknown;
}

interface XapiRow {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  verb: string;
  object_id: string;
  result: unknown;
  stored_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toCaliper(row: CaliperRow): CaliperEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    type: row.type,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    orgUnitId: row.org_unit_id,
    eventTime: asIso(row.event_time),
    envelope: asObject(row.envelope),
  };
}

function toXapi(row: XapiRow): XapiStatementRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    verb: row.verb,
    objectId: row.object_id,
    result:
      row.result && typeof row.result === "object"
        ? (row.result as Record<string, unknown>)
        : null,
    storedAt: asIso(row.stored_at),
  };
}

const CALIPER_SELECT = `
  SELECT id, tenant_id, actor_id, type, action, object_type, object_id,
         org_unit_id, event_time, envelope
    FROM caliper_event`;

interface RollupRow {
  org_unit_id: string;
  name: string;
  code: string | null;
  course_count: number | string;
  enrollment_count: number | string;
  attendance_present: number | string;
  attendance_total: number | string;
  avg_grade: number | string | null;
}

function toRollup(row: RollupRow): OrgUnitRollup {
  const present = Number(row.attendance_present);
  const total = Number(row.attendance_total);
  return {
    orgUnitId: row.org_unit_id,
    name: row.name,
    code: row.code,
    courseCount: Number(row.course_count),
    enrollmentCount: Number(row.enrollment_count),
    attendanceRate: ratePct(present, total),
    averageGrade: row.avg_grade === null ? null : round1(Number(row.avg_grade)),
  };
}

// One rollup row per `organization` org unit ("school"), summed across its
// subtree. An org unit is in the subtree when its id equals the school id or
// the school id appears in its materialised `path`. RLS (withTenant) scopes
// every subquery to the caller's tenant, so no tenant_id filter is needed and
// there are no uuid params to cast.
const ROLLUP_SQL = `
  SELECT
    s.id   AS org_unit_id,
    s.name AS name,
    s.code AS code,
    (SELECT count(*) FROM course c
       JOIN org_unit ou ON ou.id = c.org_unit_id
       WHERE ou.id = s.id OR s.id = ANY(ou.path))::int AS course_count,
    (SELECT count(*) FROM enrollment e
       JOIN org_unit ou ON ou.id = e.org_unit_id
       WHERE ou.id = s.id OR s.id = ANY(ou.path))::int AS enrollment_count,
    (SELECT count(*) FROM attendance_record ar
       JOIN attendance_session ss ON ss.id = ar.session_id
       JOIN org_unit ou ON ou.id = ss.org_unit_id
       JOIN attendance_code ac
         ON ac.tenant_id = ar.tenant_id AND ac.code = ar.code
       WHERE ac.category = 'present'
         AND (ou.id = s.id OR s.id = ANY(ou.path)))::int AS attendance_present,
    (SELECT count(*) FROM attendance_record ar
       JOIN attendance_session ss ON ss.id = ar.session_id
       JOIN org_unit ou ON ou.id = ss.org_unit_id
       WHERE ou.id = s.id OR s.id = ANY(ou.path))::int AS attendance_total,
    (SELECT avg(g.points / gi.max_points * 100)
       FROM grade g
       JOIN grade_item gi ON gi.id = g.grade_item_id
       JOIN course c ON c.id = gi.course_id
       JOIN org_unit ou ON ou.id = c.org_unit_id
       WHERE g.is_released AND g.points IS NOT NULL AND gi.max_points > 0
         AND (ou.id = s.id OR s.id = ANY(ou.path))) AS avg_grade
  FROM org_unit s
  WHERE s.type = 'organization'
  ORDER BY s.name ASC`;

// --- Per-course engagement (#277) ------------------------------------------
// Five small, fully BOUND sub-queries (NO string interpolation; $1::uuid is the
// only param — the #267 rule: cast only uuid columns). All run inside one
// withTenant tx so RLS scopes every row to the caller's tenant. The course's
// offering is `course.org_unit_id`; learners are `enrollment` rows on that
// offering with the 'learner' role and an active/completed status. Results feed
// the pure `buildCourseEngagement` so memory and Prisma paths agree.
const ENGAGEMENT_LEARNERS_SQL = `
  SELECT e.user_id AS learner_id
    FROM enrollment e
    JOIN course c ON c.org_unit_id = e.org_unit_id
    JOIN role r ON r.id = e.role_id
   WHERE c.id = $1::uuid
     AND r.name = 'learner'
     AND e.status IN ('active','completed')`;

const ENGAGEMENT_ASSIGNMENTS_SQL = `
  SELECT count(*)::int AS n FROM assignment WHERE course_id = $1::uuid`;

const ENGAGEMENT_ATTENDANCE_SQL = `
  SELECT ar.user_id AS learner_id, (ac.category = 'present') AS present
    FROM attendance_record ar
    JOIN attendance_session ss ON ss.id = ar.session_id
    JOIN course c ON c.org_unit_id = ss.org_unit_id
    JOIN attendance_code ac
      ON ac.tenant_id = ar.tenant_id AND ac.code = ar.code
   WHERE c.id = $1::uuid`;

const ENGAGEMENT_SUBMISSIONS_SQL = `
  SELECT s.user_id AS learner_id
    FROM submission s
    JOIN assignment a ON a.id = s.assignment_id
   WHERE a.course_id = $1::uuid
     AND s.status IN ('submitted','resubmitted','returned')`;

const ENGAGEMENT_GRADES_SQL = `
  SELECT g.user_id AS learner_id,
         (g.points / gi.max_points * 100) AS pct
    FROM grade g
    JOIN grade_item gi ON gi.id = g.grade_item_id
   WHERE gi.course_id = $1::uuid
     AND g.is_released AND g.points IS NOT NULL AND gi.max_points > 0`;

// --- Course-read authorization (#284) --------------------------------------
// Trusted "does this user teach this course?" signal for the engagement guard.
// RLS-scoped (withTenant) and fully BOUND — both uuid params are cast per the
// #267 rule. A teaching enrollment = a row on the course's offering
// (course.org_unit_id) with a teaching role and an active/completed status.
const TEACHES_COURSE_SQL = `
  SELECT 1
    FROM enrollment e
    JOIN course c ON c.org_unit_id = e.org_unit_id
    JOIN role   r ON r.id = e.role_id
   WHERE c.id = $1::uuid
     AND e.user_id = $2::uuid
     AND r.name IN ('instructor','teacher','teaching_assistant')
     AND e.status IN ('active','completed')
   LIMIT 1`;

interface LearnerRow {
  learner_id: string;
}
interface CountRow {
  n: number | string;
}
interface AttendanceRow {
  learner_id: string;
  present: boolean;
}
interface GradeRow {
  learner_id: string;
  pct: number | string;
}

/** RLS-scoped LRS store (uuid params cast; outbox written in the same tx). */
export function createPrismaStore(): AnalyticsStore {
  return {
    async recordCaliperEvent(
      ctx,
      input: NewCaliperEventInput,
    ): Promise<CaliperEventRecord> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<CaliperRow[]>(
          `INSERT INTO caliper_event
             (tenant_id, actor_id, type, action, object_type, object_id,
              org_unit_id, event_time, envelope)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid,
                   COALESCE($8::timestamptz, now()), $9::jsonb)
           RETURNING id, tenant_id, actor_id, type, action, object_type,
                     object_id, org_unit_id, event_time, envelope`,
          ctx.tenantId,
          input.actorId ?? null,
          input.type,
          input.action,
          input.objectType,
          input.objectId,
          input.orgUnitId ?? null,
          input.eventTime ?? null,
          JSON.stringify(input.envelope ?? {}),
        );
        const event = toCaliper(rows[0]!);
        // Transactional outbox: the relay forwards this to QStash exactly-once.
        await db.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, actor_id, org_unit_id, payload)
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::jsonb)`,
          ctx.tenantId,
          EVENT_TYPES.LEARNING_EVENT_CAPTURED,
          event.actorId,
          event.orgUnitId,
          JSON.stringify({
            caliperEventId: event.id,
            type: event.type,
            action: event.action,
          }),
        );
        return event;
      });
    },

    async recordXapiStatement(
      ctx,
      input: NewXapiStatementInput,
    ): Promise<XapiStatementRecord> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<XapiRow[]>(
          `INSERT INTO xapi_statement (tenant_id, actor_id, verb, object_id, result)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
           RETURNING id, tenant_id, actor_id, verb, object_id, result, stored_at`,
          ctx.tenantId,
          input.actorId ?? null,
          input.verb,
          input.objectId,
          input.result ? JSON.stringify(input.result) : null,
        );
        return toXapi(rows[0]!);
      });
    },

    async listEvents(ctx, filter?: EventFilter): Promise<CaliperEventRecord[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<CaliperRow[]>(
          `${CALIPER_SELECT}
            WHERE ($1::text IS NULL OR type = $1)
              AND ($2::text IS NULL OR action = $2)
              AND ($3::timestamptz IS NULL OR event_time >= $3::timestamptz)
              AND ($4::timestamptz IS NULL OR event_time < $4::timestamptz)
            ORDER BY event_time DESC`,
          filter?.type ?? null,
          filter?.action ?? null,
          filter?.from ?? null,
          filter?.to ?? null,
        );
        return rows.map(toCaliper);
      });
    },

    async aggregate(
      ctx,
      dimension: AggregateDimension,
      filter?: EventFilter,
    ): Promise<DeidentifiedAggregate> {
      // Reuse listEvents then aggregate in-process: de-identified (no actor) and
      // identical to the memory path, so behaviour matches across stores.
      const events = await this.listEvents(ctx, filter);
      return aggregateEvents(events, dimension);
    },

    async listOrgUnitRollups(ctx): Promise<OrgUnitRollup[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RollupRow[]>(ROLLUP_SQL);
        return rows.map(toRollup);
      });
    },

    async getCourseEngagement(
      ctx,
      courseId: string,
    ): Promise<CourseEngagementResult> {
      return withTenant(ctx, async (db: Db) => {
        const [learners, assignments, attendance, submissions, grades] =
          await Promise.all([
            db.$queryRawUnsafe<LearnerRow[]>(ENGAGEMENT_LEARNERS_SQL, courseId),
            db.$queryRawUnsafe<CountRow[]>(ENGAGEMENT_ASSIGNMENTS_SQL, courseId),
            db.$queryRawUnsafe<AttendanceRow[]>(
              ENGAGEMENT_ATTENDANCE_SQL,
              courseId,
            ),
            db.$queryRawUnsafe<LearnerRow[]>(
              ENGAGEMENT_SUBMISSIONS_SQL,
              courseId,
            ),
            db.$queryRawUnsafe<GradeRow[]>(ENGAGEMENT_GRADES_SQL, courseId),
          ]);

        const data: EngagementSourceData = {
          learnerIds: learners.map((r) => r.learner_id),
          assignmentCount: Number(assignments[0]?.n ?? 0),
          attendance: attendance.map((r) => ({
            learnerId: r.learner_id,
            present: r.present === true,
          })),
          submissions: submissions.map((r) => ({ learnerId: r.learner_id })),
          grades: grades.map((r) => ({
            learnerId: r.learner_id,
            pct: round1(Number(r.pct)),
          })),
        };
        return buildCourseEngagement(courseId, data);
      });
    },

    async teachesCourse(
      ctx,
      userId: string,
      courseId: string,
    ): Promise<boolean> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<unknown[]>(
          TEACHES_COURSE_SQL,
          courseId,
          userId,
        );
        return rows.length > 0;
      });
    },
  };
}
