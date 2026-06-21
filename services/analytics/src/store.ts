import type { TenantContext } from "@lms/types";

/**
 * Learning Record Store for the analytics service (issue #60). Captures
 * standardized learning events (Caliper) and xAPI statements into the
 * tenant-scoped LRS tables, writing a transactional outbox row alongside each
 * Caliper event so delivery to downstream/QStash is async and exactly-once.
 * De-identified aggregates (counts with no actor identity) are safe to combine
 * across tenants.
 */

export interface CaliperEventRecord {
  id: string;
  tenantId: string;
  actorId: string | null;
  type: string;
  action: string;
  objectType: string;
  objectId: string;
  orgUnitId: string | null;
  eventTime: string;
  envelope: Record<string, unknown>;
}

export interface NewCaliperEventInput {
  actorId?: string | null;
  type: string;
  action: string;
  objectType: string;
  objectId: string;
  orgUnitId?: string | null;
  eventTime?: string;
  envelope?: Record<string, unknown>;
}

export interface XapiStatementRecord {
  id: string;
  tenantId: string;
  actorId: string | null;
  verb: string;
  objectId: string;
  result: Record<string, unknown> | null;
  storedAt: string;
}

export interface NewXapiStatementInput {
  actorId?: string | null;
  verb: string;
  objectId: string;
  result?: Record<string, unknown> | null;
}

export interface EventFilter {
  type?: string;
  action?: string;
  from?: string;
  to?: string;
}

/** Dimensions a de-identified aggregate can group by. */
export type AggregateDimension = "type" | "action" | "objectType";
export const AGGREGATE_DIMENSIONS: readonly AggregateDimension[] = [
  "type",
  "action",
  "objectType",
];

export interface AggregateBucket {
  key: string;
  count: number;
}

/**
 * A de-identified aggregate: total event count and per-key counts for one
 * dimension. Carries NO actor identity, so it can be pooled cross-tenant.
 */
export interface DeidentifiedAggregate {
  dimension: AggregateDimension;
  total: number;
  buckets: AggregateBucket[];
}

/**
 * Pure aggregation over events, grouped by a dimension. Deterministic order
 * (count desc, then key asc) so output is stable for tests and dashboards.
 */
export function aggregateEvents(
  events: Pick<CaliperEventRecord, "type" | "action" | "objectType">[],
  dimension: AggregateDimension,
): DeidentifiedAggregate {
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = e[dimension];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets = [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { dimension, total: events.length, buckets };
}

// ---------------------------------------------------------------------------
// Reporting roll-ups (issue #269) — per-"school" aggregates for the admin
// /reports screen. Analytics is the reporting bounded context; it reads the
// existing tenant-scoped domain tables under RLS (withTenant) and exposes a
// read-only rollup. No new tables.
// ---------------------------------------------------------------------------

/** A per-org-unit ("school") rollup row for the admin reports screen. */
export interface OrgUnitRollup {
  orgUnitId: string;
  name: string;
  code: string | null;
  /** Courses anywhere in this org unit's subtree. */
  courseCount: number;
  /** Enrollment rows (all roles) anywhere in this org unit's subtree. */
  enrollmentCount: number;
  /**
   * Share of attendance records marked 'present', as a percentage 0-100 (one
   * decimal place); null when no attendance has been recorded.
   */
  attendanceRate: number | null;
  /**
   * Mean released grade as a percentage of max points, 0-100 (one decimal
   * place); null when no grades have been released.
   */
  averageGrade: number | null;
}

/** District-level headline across all org-unit rollups. */
export interface RollupSummary {
  orgUnitCount: number;
  courseCount: number;
  enrollmentCount: number;
  /** Enrollment-weighted mean attendance rate, 0-100 (1 dp); null if no data. */
  attendanceRate: number | null;
  /** Enrollment-weighted mean released grade, 0-100 (1 dp); null if no data. */
  averageGrade: number | null;
}

/**
 * Minimal domain rows the rollup aggregation consumes, for ONE tenant. The
 * Prisma store derives the same shape in SQL; the memory store holds it
 * literally. Keeping the aggregation pure (below) makes it unit-testable.
 */
export interface RollupSourceData {
  orgUnits: {
    id: string;
    name: string;
    code: string | null;
    type: string;
    /** Materialised ancestor ids (matches `org_unit.path`). */
    path: string[];
  }[];
  /** A course, keyed by the org unit (course-offering) it belongs to. */
  courses: { orgUnitId: string }[];
  /** An enrollment, keyed by the org unit it targets. */
  enrollments: { orgUnitId: string }[];
  /** One attendance record, keyed by its session's org unit. */
  attendance: { orgUnitId: string; present: boolean }[];
  /** One released grade as a 0-100 percentage, keyed by its course's org unit. */
  grades: { orgUnitId: string; pct: number }[];
}

/** Round to one decimal place — stable for display and tests. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Percentage (0-100, 1 dp) of `part` over `whole`; null when `whole` is 0. */
export function ratePct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return round1((part / whole) * 100);
}

/**
 * Pure aggregation: one rollup row per `organization` org unit, summing across
 * its subtree (an org unit is in the subtree when its id equals the school id
 * or the school id appears in its `path`). Sorted by name for stable output.
 */
export function buildOrgUnitRollups(data: RollupSourceData): OrgUnitRollup[] {
  const pathById = new Map<string, string[]>();
  for (const ou of data.orgUnits) pathById.set(ou.id, ou.path);

  const belongs = (ouId: string, schoolId: string): boolean =>
    ouId === schoolId || (pathById.get(ouId) ?? []).includes(schoolId);

  return data.orgUnits
    .filter((ou) => ou.type === "organization")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((school) => {
      const courseCount = data.courses.filter((c) =>
        belongs(c.orgUnitId, school.id),
      ).length;
      const enrollmentCount = data.enrollments.filter((e) =>
        belongs(e.orgUnitId, school.id),
      ).length;
      const att = data.attendance.filter((a) => belongs(a.orgUnitId, school.id));
      const present = att.filter((a) => a.present).length;
      const grades = data.grades.filter((g) => belongs(g.orgUnitId, school.id));
      const averageGrade = grades.length
        ? round1(grades.reduce((s, g) => s + g.pct, 0) / grades.length)
        : null;
      return {
        orgUnitId: school.id,
        name: school.name,
        code: school.code,
        courseCount,
        enrollmentCount,
        attendanceRate: ratePct(present, att.length),
        averageGrade,
      };
    });
}

/**
 * Enrollment-weighted mean of a nullable per-school metric. Falls back to an
 * unweighted mean when every contributing school has zero enrollment (so the
 * total weight is 0), so data is never silently dropped.
 */
function weightedMean(
  rollups: OrgUnitRollup[],
  pick: (r: OrgUnitRollup) => number | null,
): number | null {
  let weighted = 0;
  let weight = 0;
  let plainSum = 0;
  let plainCount = 0;
  for (const r of rollups) {
    const value = pick(r);
    if (value === null) continue;
    plainSum += value;
    plainCount += 1;
    weighted += value * r.enrollmentCount;
    weight += r.enrollmentCount;
  }
  if (plainCount === 0) return null;
  return weight > 0 ? round1(weighted / weight) : round1(plainSum / plainCount);
}

/** Derive the district headline summary across org-unit rollups. */
export function summarizeOrgUnitRollups(rollups: OrgUnitRollup[]): RollupSummary {
  return {
    orgUnitCount: rollups.length,
    courseCount: rollups.reduce((s, r) => s + r.courseCount, 0),
    enrollmentCount: rollups.reduce((s, r) => s + r.enrollmentCount, 0),
    attendanceRate: weightedMean(rollups, (r) => r.attendanceRate),
    averageGrade: weightedMean(rollups, (r) => r.averageGrade),
  };
}

// ---------------------------------------------------------------------------
// Per-course engagement + at-risk learners (issue #277) — a tenant-scoped read
// powering the teacher `/teach` insights. Analytics is the reporting bounded
// context; it computes LIVE from the existing domain tables under RLS
// (withTenant) — the `engagement_summary` CQRS table has no writer, so it is
// intentionally NOT used (ADR-277). No new tables.
// ---------------------------------------------------------------------------

/** At-risk rule codes — each only contributes when its signal exists. */
export type RiskReasonCode =
  | "low_attendance"
  | "missing_submissions"
  | "low_grades";

/** Below this attendance percentage a learner trips `low_attendance`. */
export const LOW_ATTENDANCE_THRESHOLD = 80;
/**
 * Below this per-learner submission percentage a learner trips
 * `missing_submissions` (i.e. a missing fraction above 30%).
 */
export const SUBMISSION_RATE_THRESHOLD = 70;
/** Below this grade percentage a learner trips `low_grades`. */
export const LOW_GRADE_THRESHOLD = 60;
/** A learner is `high` risk at this many tripped rules, else `medium`. */
export const HIGH_RISK_MIN_REASONS = 2;

/** One tripped at-risk rule, with the learner's metric and its threshold. */
export interface RiskReason {
  code: RiskReasonCode;
  /** The learner's value for this signal (0-100, 1 dp). */
  metric: number;
  /** The threshold the metric fell below. */
  threshold: number;
}

/** An enrolled learner flagged at risk, with the rules they tripped. */
export interface AtRiskLearner {
  /** `app_user.id` = `enrollment.user_id`. */
  learnerId: string;
  /** Intentionally null until roster-name enrichment (#278/#279); ids only. */
  displayName: string | null;
  riskLevel: "high" | "medium";
  reasons: RiskReason[];
}

/** The three equal-weighted engagement signals, each null when no data. */
export interface EngagementComponents {
  /** Share of attendance records marked present, 0-100 (1 dp); null if none. */
  attendanceRate: number | null;
  /** Submissions over expected (assignments × learners), 0-100; null if none. */
  submissionRate: number | null;
  /** Mean released grade as a percentage, 0-100 (1 dp); null if none. */
  gradeAverage: number | null;
}

/** Per-course engagement headline. */
export interface CourseEngagement {
  courseId: string;
  /** Equal-weighted mean of the non-null components, 0-100; null if all null. */
  score: number | null;
  /** Distinct enrolled learners (learner role, active/completed). */
  learnerCount: number;
  components: EngagementComponents;
}

/** The full engagement read: headline + the at-risk roster. */
export interface CourseEngagementResult {
  engagement: CourseEngagement;
  atRisk: AtRiskLearner[];
}

/**
 * Minimal per-learner domain rows the engagement aggregation consumes, for ONE
 * course in ONE tenant. The Prisma store derives this shape in SQL; the memory
 * store holds it literally. Keeping the aggregation pure (below) makes it
 * unit-testable without a DB.
 */
export interface EngagementSourceData {
  /** Enrolled learner ids (learner role, status active/completed). */
  learnerIds: string[];
  /** Number of assignments in the course (the per-learner submission target). */
  assignmentCount: number;
  /** One attendance record per row, keyed by the learner and present flag. */
  attendance: { learnerId: string; present: boolean }[];
  /** One counted submission per row (submitted/resubmitted/returned). */
  submissions: { learnerId: string }[];
  /** One released grade as a 0-100 percentage, keyed by the learner. */
  grades: { learnerId: string; pct: number }[];
}

/** Mean (1 dp) of the non-null component scores; null when all are null. */
function meanOfComponents(components: EngagementComponents): number | null {
  const present = [
    components.attendanceRate,
    components.submissionRate,
    components.gradeAverage,
  ].filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return round1(present.reduce((s, v) => s + v, 0) / present.length);
}

/** Mean (1 dp) of a list of percentages, or null when empty. */
function meanPct(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((s, v) => s + v, 0) / values.length);
}

/**
 * Pure aggregation: compute a course's engagement components + score and the
 * at-risk learner roster from the raw per-learner signals. Signals are scoped
 * to enrolled learners; each at-risk rule contributes only when its underlying
 * signal exists for that learner. Sorted high→medium, then reason count desc,
 * then learnerId asc, for stable output.
 */
export function buildCourseEngagement(
  courseId: string,
  data: EngagementSourceData,
): CourseEngagementResult {
  const learners = new Set(data.learnerIds);
  const learnerCount = learners.size;

  // Scope every signal to enrolled learners so components and per-learner
  // at-risk rules agree (non-learner rows, e.g. an instructor, are ignored).
  const attendance = data.attendance.filter((a) => learners.has(a.learnerId));
  const submissions = data.submissions.filter((s) => learners.has(s.learnerId));
  const grades = data.grades.filter((g) => learners.has(g.learnerId));

  const attendanceRate = ratePct(
    attendance.filter((a) => a.present).length,
    attendance.length,
  );
  const submissionRate =
    data.assignmentCount > 0 && learnerCount > 0
      ? ratePct(submissions.length, data.assignmentCount * learnerCount)
      : null;
  const gradeAverage = meanPct(grades.map((g) => g.pct));

  const components: EngagementComponents = {
    attendanceRate,
    submissionRate,
    gradeAverage,
  };

  const atRisk: AtRiskLearner[] = [];
  for (const learnerId of data.learnerIds) {
    const reasons: RiskReason[] = [];

    const la = attendance.filter((a) => a.learnerId === learnerId);
    const lAttendance = ratePct(la.filter((a) => a.present).length, la.length);
    if (lAttendance !== null && lAttendance < LOW_ATTENDANCE_THRESHOLD) {
      reasons.push({
        code: "low_attendance",
        metric: lAttendance,
        threshold: LOW_ATTENDANCE_THRESHOLD,
      });
    }

    if (data.assignmentCount > 0) {
      const submitted = submissions.filter(
        (s) => s.learnerId === learnerId,
      ).length;
      const lSubmission = round1((submitted / data.assignmentCount) * 100);
      if (lSubmission < SUBMISSION_RATE_THRESHOLD) {
        reasons.push({
          code: "missing_submissions",
          metric: lSubmission,
          threshold: SUBMISSION_RATE_THRESHOLD,
        });
      }
    }

    const lGrade = meanPct(
      grades.filter((g) => g.learnerId === learnerId).map((g) => g.pct),
    );
    if (lGrade !== null && lGrade < LOW_GRADE_THRESHOLD) {
      reasons.push({
        code: "low_grades",
        metric: lGrade,
        threshold: LOW_GRADE_THRESHOLD,
      });
    }

    if (reasons.length === 0) continue;
    atRisk.push({
      learnerId,
      displayName: null,
      riskLevel: reasons.length >= HIGH_RISK_MIN_REASONS ? "high" : "medium",
      reasons,
    });
  }

  const riskRank = (r: AtRiskLearner): number => (r.riskLevel === "high" ? 0 : 1);
  atRisk.sort(
    (a, b) =>
      riskRank(a) - riskRank(b) ||
      b.reasons.length - a.reasons.length ||
      a.learnerId.localeCompare(b.learnerId),
  );

  return {
    engagement: { courseId, score: meanOfComponents(components), learnerCount, components },
    atRisk,
  };
}

/** Tenant-scoped LRS persistence (RLS via withTenant). */
export interface AnalyticsStore {
  /** Persist a Caliper event AND a transactional outbox row in one tx. */
  recordCaliperEvent(
    ctx: TenantContext,
    input: NewCaliperEventInput,
  ): Promise<CaliperEventRecord>;

  recordXapiStatement(
    ctx: TenantContext,
    input: NewXapiStatementInput,
  ): Promise<XapiStatementRecord>;

  listEvents(
    ctx: TenantContext,
    filter?: EventFilter,
  ): Promise<CaliperEventRecord[]>;

  aggregate(
    ctx: TenantContext,
    dimension: AggregateDimension,
    filter?: EventFilter,
  ): Promise<DeidentifiedAggregate>;

  /**
   * Per-"school" reporting rollups for the admin /reports screen (#269).
   * Read-only; aggregates the tenant's existing domain tables under RLS.
   */
  listOrgUnitRollups(ctx: TenantContext): Promise<OrgUnitRollup[]>;

  /**
   * Per-course engagement score + at-risk learners for the teacher `/teach`
   * insights (#277). Read-only; computes LIVE over the tenant's enrollment,
   * attendance, submission and grade tables under RLS. No writes.
   */
  getCourseEngagement(
    ctx: TenantContext,
    courseId: string,
  ): Promise<CourseEngagementResult>;

  /**
   * Defence-in-depth authorization signal for `GET /reports/engagement` (#284):
   * does `userId` hold a teaching enrollment (instructor/teacher/TA, status
   * active/completed) on `courseId`'s offering? RLS-scoped via withTenant — a
   * trusted, server-derived fact, never a client claim. Layered ON TOP of RLS.
   */
  teachesCourse(
    ctx: TenantContext,
    userId: string,
    courseId: string,
  ): Promise<boolean>;

  /**
   * Defence-in-depth org-scope signal for `GET /reports/engagement` (#294):
   * does `userId` hold an `org_admin` role_assignment whose org unit contains
   * the course's org unit — the unit itself, or (when the assignment cascades)
   * any ancestor of it via `org_unit.path`? RLS-scoped via withTenant. Layered
   * ON TOP of RLS; never a client claim. `super_admin` does NOT use this — it
   * stays tenant-wide.
   */
  adminScopesCourse(
    ctx: TenantContext,
    userId: string,
    courseId: string,
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Course-read authorization (#284, refined #294) — defence-in-depth on top of
// RLS for `GET /reports/engagement`. Pure + unit-testable (mirrors @lms/auth
// checkAccess purity): the caller is allowed when they are a tenant-wide
// `super_admin`, an `org_admin` whose org-unit scope contains the course
// (#294), OR they teach the course. The "teaches"/"adminScopesCourse" facts are
// derived from trusted sources resolved under RLS, never client-supplied claims.
// ---------------------------------------------------------------------------

/** Tenant-wide admin persona that may read any course's engagement. */
export const SUPER_ADMIN_ROLE = "super_admin";
/** Org-scoped admin persona — limited to the org-unit subtree it administers. */
export const ORG_ADMIN_ROLE = "org_admin";

/**
 * Tenant admin personas (kept for backwards reference; no longer the sole gate
 * — `org_admin` is now org-scoped, see `isCourseReadAuthorized`).
 */
export const ADMIN_ROLES = [SUPER_ADMIN_ROLE, ORG_ADMIN_ROLE] as const;

/** Enrollment roles that count as "teaches the course" for authorization. */
export const TEACHING_ENROLLMENT_ROLES = [
  "instructor",
  "teacher",
  "teaching_assistant",
] as const;

/**
 * Pure authorization decision for a course-engagement read. Allowed iff the
 * caller is a tenant-wide `super_admin`, OR an `org_admin` whose scope contains
 * the course (`adminScopesCourse`), OR the (trusted) `teaches` signal is true.
 * The OR with `teaches` means an org_admin outside the course's subtree is
 * still allowed when they personally teach it.
 */
export function isCourseReadAuthorized(input: {
  roles: string[];
  teaches: boolean;
  adminScopesCourse: boolean;
}): boolean {
  const isSuperAdmin = input.roles.includes(SUPER_ADMIN_ROLE);
  const isOrgAdmin = input.roles.includes(ORG_ADMIN_ROLE);
  return (
    isSuperAdmin || // tenant-wide
    (isOrgAdmin && input.adminScopesCourse) || // org-scoped (#294)
    input.teaches // teacher path (unchanged)
  );
}
