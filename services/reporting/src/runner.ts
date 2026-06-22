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

      // course-completion-summary: per-course enrolled vs. completed counts.
      // course links to enrollment via the shared org_unit (course.org_unit_id
      // is UNIQUE and enrollment.org_unit_id references the same section).
      const rows = await db.$queryRawUnsafe<CourseCompletionRow[]>(
        `SELECT c.id AS course_id,
                c.title AS title,
                count(e.id)::int AS enrolled,
                count(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
           FROM course c
           LEFT JOIN enrollment e ON e.org_unit_id = c.org_unit_id
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
