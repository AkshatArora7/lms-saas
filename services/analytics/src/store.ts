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
}
