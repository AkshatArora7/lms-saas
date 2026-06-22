import { withTenant } from "@lms/db";
import type { TenantContext } from "@lms/types";

import { isBuiltinDefinitionKey } from "./store.js";

/** The computed output of one report execution. */
export interface ReportRunResult {
  /** A jsonb-serializable payload persisted to report_run.result. */
  result: unknown;
  /** The number of rows the report produced (persisted to row_count). */
  rowCount: number;
}

/**
 * The seam that keeps reporting offline-testable and decoupled from the heavy
 * SQL: production wires {@link DbReportRunner} (reads existing tenant-scoped
 * tables under the same RLS connection), while tests inject a deterministic
 * {@link FakeReportRunner} with no DB or network. Implementations throw on an
 * unknown definition key or invalid params.
 */
export interface ReportRunner {
  run(
    ctx: TenantContext,
    definitionKey: string,
    params: Record<string, unknown>,
  ): Promise<ReportRunResult>;
}

/** Thrown when a runner is asked for a definition key it does not implement. */
export class UnknownReportError extends Error {
  constructor(key: string) {
    super(`No runner implemented for report '${key}'.`);
    this.name = "UnknownReportError";
  }
}

interface StatusCountRow {
  status: string;
  count: number | string;
}

interface CourseCompletionRow {
  course_id: string;
  title: string;
  enrolled: number | string;
  completed: number | string;
}

/** A course offering as seen by the completion rollup. */
export interface CompletionCourse {
  id: string;
  title: string;
  /** The course_offering org_unit this course is published under. */
  orgUnitId: string;
}

/** An org_unit node with its materialised ancestor `path` (root-first, EXCLUDES self). */
export interface CompletionOrgUnit {
  id: string;
  path: string[];
}

/** One enrollment, attached at section (or offering) granularity. */
export interface CompletionEnrollment {
  /** The org_unit (typically a child section) the learner is enrolled in. */
  orgUnitId: string;
  status: string;
}

/** One rollup row: enrolled vs. completed across a course offering's subtree. */
export interface CompletionRollupRow {
  courseId: string;
  title: string;
  enrolled: number;
  completed: number;
}

/**
 * Pure aggregation mirroring the production SQL's subtree semantics (#323): an
 * enrollment counts toward a course when the enrollment's org_unit IS the
 * course's offering org_unit, OR the offering org_unit is an ancestor of the
 * enrollment's org_unit (i.e. it appears in that node's materialised `path`).
 * `path` is root-first and EXCLUDES self, so the offering node must be matched
 * by id separately — same precedent as analytics `buildOrgUnitRollups`
 * (store.ts:181). Kept pure (no DB) so the rollup is unit-testable offline, and
 * so {@link DbReportRunner}'s SQL has a verifiable reference for the same logic.
 * Output is sorted by title for stable ordering.
 */
export function rollupCourseCompletion(
  courses: CompletionCourse[],
  orgUnits: CompletionOrgUnit[],
  enrollments: CompletionEnrollment[],
): CompletionRollupRow[] {
  const pathById = new Map<string, string[]>();
  for (const ou of orgUnits) pathById.set(ou.id, ou.path);

  // An enrollment belongs to an offering when it's on the offering node itself
  // or on any descendant (the offering id appears in the node's ancestor path).
  const belongs = (enrollmentOrgUnitId: string, offeringId: string): boolean =>
    enrollmentOrgUnitId === offeringId ||
    (pathById.get(enrollmentOrgUnitId) ?? []).includes(offeringId);

  return courses
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((course) => {
      const matched = enrollments.filter((e) =>
        belongs(e.orgUnitId, course.orgUnitId),
      );
      return {
        courseId: course.id,
        title: course.title,
        enrolled: matched.length,
        completed: matched.filter((e) => e.status === "completed").length,
      };
    });
}

/**
 * Default production runner. Computes the two built-in reports by aggregating
 * existing tenant-scoped tables (enrollment, course) UNDER the same RLS-scoped
 * connection, so a run only ever sees the caller tenant's data. SQL is simple,
 * bound-param, and casts uuid params `$n::uuid` per the uuid=text rule (#267).
 */
export class DbReportRunner implements ReportRunner {
  async run(
    ctx: TenantContext,
    definitionKey: string,
    _params: Record<string, unknown>,
  ): Promise<ReportRunResult> {
    if (!isBuiltinDefinitionKey(definitionKey)) {
      throw new UnknownReportError(definitionKey);
    }
    return withTenant(ctx, async (db) => {
      if (definitionKey === "enrollment-summary") {
        const rows = await db.$queryRawUnsafe<StatusCountRow[]>(
          `SELECT status, count(*)::int AS count
             FROM enrollment
            GROUP BY status
            ORDER BY status`,
        );
        const byStatus = rows.map((r) => ({
          status: r.status,
          count: Number(r.count),
        }));
        const total = byStatus.reduce((sum, r) => sum + r.count, 0);
        return { result: { total, byStatus }, rowCount: byStatus.length };
      }

      // course-completion-summary: per-course enrolled vs. completed counts (#323).
      // course.org_unit_id is the course_offering node; enrollments attach at
      // child SECTION granularity, so a flat equality join matches zero rows.
      // Aggregate over the offering's subtree instead: an enrollment counts when
      // its org_unit IS the offering, OR the offering is an ancestor of it (its id
      // appears in the node's materialised `path`, which is root-first and
      // EXCLUDES self — hence the offering id is matched separately). Mirrors the
      // pure {@link rollupCourseCompletion} helper. Still inside withTenant, so
      // every table read (incl. the org_unit subquery) is RLS-scoped — isolation
      // is preserved. Join is column-to-column, so no $n::uuid casts are needed.
      const rows = await db.$queryRawUnsafe<CourseCompletionRow[]>(
        `SELECT c.id AS course_id,
                c.title AS title,
                count(e.id)::int AS enrolled,
                count(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
           FROM course c
           LEFT JOIN enrollment e
                  ON e.org_unit_id = c.org_unit_id
                  OR e.org_unit_id IN (
                       SELECT d.id FROM org_unit d
                        WHERE c.org_unit_id = ANY(d.path)
                     )
          GROUP BY c.id, c.title
          ORDER BY c.title`,
      );
      const courses = rows.map((r) => ({
        courseId: r.course_id,
        title: r.title,
        enrolled: Number(r.enrolled),
        completed: Number(r.completed),
      }));
      return { result: { courses }, rowCount: courses.length };
    });
  }
}

/** Default production runner. */
export function makeReportRunner(): ReportRunner {
  return new DbReportRunner();
}

/**
 * Deterministic, dependency-free runner used by the offline test suite and
 * `REPORTING_STORE=memory` dev. Returns a fixed payload per built-in key and
 * throws {@link UnknownReportError} for anything else — no DB, no network.
 */
export class FakeReportRunner implements ReportRunner {
  async run(
    _ctx: TenantContext,
    definitionKey: string,
    _params: Record<string, unknown>,
  ): Promise<ReportRunResult> {
    switch (definitionKey) {
      case "enrollment-summary":
        return {
          result: {
            total: 3,
            byStatus: [
              { status: "active", count: 2 },
              { status: "completed", count: 1 },
            ],
          },
          rowCount: 2,
        };
      case "course-completion-summary":
        return {
          result: {
            courses: [
              { courseId: "course-1", title: "Intro", enrolled: 2, completed: 1 },
            ],
          },
          rowCount: 1,
        };
      default:
        throw new UnknownReportError(definitionKey);
    }
  }
}
