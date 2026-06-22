import { withTenant } from "@lms/db";
import type { TenantContext } from "@lms/types";

import { ADMIN_ROLES } from "./routes.js";

/**
 * Trusted caller identity used for course-access decisions (ADR-0027): the
 * `x-user-id` the gateway stamps plus the verified `x-user-roles`.
 */
export interface Principal {
  userId: string;
  roles: string[];
}

/**
 * Course-scoped read authorization for videos (#319, ADR-0031). A video may
 * carry an optional `course_id`; when set, only an enrolled student, a
 * teacher/TA of that course, or an admin may read/stream it. The check is an
 * APP-AUTHZ filter layered on top of RLS — every query still runs under the
 * caller's tenant GUC via `withTenant`.
 */
export interface CourseAccessPolicy {
  /** May this principal read a video associated with `courseId`, within `ctx`'s tenant? */
  canRead(
    ctx: TenantContext,
    courseId: string,
    principal: Principal,
  ): Promise<boolean>;
  /** The subset of `courseIds` the principal may read (batch helper for list filtering). */
  visibleCourseIds(
    ctx: TenantContext,
    courseIds: string[],
    principal: Principal,
  ): Promise<Set<string>>;
}

/** Admin personas short-circuit the enrollment check (reuses the routes set). */
function isAdminPrincipal(principal: Principal): boolean {
  return principal.roles.some((r) =>
    (ADMIN_ROLES as readonly string[]).includes(r),
  );
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
}

interface CourseIdRow {
  course_id: string;
}

/**
 * The canonical enrollment/teaching bridge (mirrors analytics `teachesCourse`,
 * services/analytics/src/store.prisma.ts:218-227): an enrollment row on the
 * course's offering org unit with an active/completed status. One EXISTS covers
 * BOTH students and teaching staff (they hold enrollment rows) — deliberately no
 * `role.name` filter, because #319 admits students too. uuid params cast `::uuid`
 * (#267).
 */
const CAN_READ_SQL = `
  SELECT 1
    FROM enrollment e
    JOIN course c ON c.org_unit_id = e.org_unit_id
   WHERE c.id = $1::uuid
     AND e.user_id = $2::uuid
     AND e.status IN ('active','completed')
   LIMIT 1`;

const VISIBLE_COURSE_IDS_SQL = `
  SELECT DISTINCT c.id AS course_id
    FROM enrollment e
    JOIN course c ON c.org_unit_id = e.org_unit_id
   WHERE c.id = ANY($1::uuid[])
     AND e.user_id = $2::uuid
     AND e.status IN ('active','completed')`;

/**
 * Production policy: admin-by-role short-circuit, else the enrollment EXISTS
 * query, all under the video service's existing `withTenant` RLS connection (no
 * HTTP to the enrollment service — ADR-0031 §A).
 */
export class DbCourseAccessPolicy implements CourseAccessPolicy {
  async canRead(
    ctx: TenantContext,
    courseId: string,
    principal: Principal,
  ): Promise<boolean> {
    if (isAdminPrincipal(principal)) return true;
    return withTenant(ctx, async (db: Db) => {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        CAN_READ_SQL,
        courseId,
        principal.userId,
      );
      return rows.length > 0;
    });
  }

  async visibleCourseIds(
    ctx: TenantContext,
    courseIds: string[],
    principal: Principal,
  ): Promise<Set<string>> {
    if (courseIds.length === 0) return new Set();
    if (isAdminPrincipal(principal)) return new Set(courseIds);
    return withTenant(ctx, async (db: Db) => {
      const rows = await db.$queryRawUnsafe<CourseIdRow[]>(
        VISIBLE_COURSE_IDS_SQL,
        courseIds,
        principal.userId,
      );
      return new Set(rows.map((r) => r.course_id));
    });
  }
}

/**
 * Deterministic offline policy: a seeded `tenantId -> courseId -> Set<userId>`
 * map plus the same admin short-circuit. Mirrors analytics' in-memory
 * `teachingSource` (services/analytics/src/store.memory.ts:199-303) so tests
 * cover enrolled-OK / non-enrolled-denied / teacher-OK / admin-OK /
 * null-course-unaffected with no DB and no network.
 */
export class FakeCourseAccessPolicy implements CourseAccessPolicy {
  constructor(
    private readonly source: Map<
      string,
      Map<string, Set<string>>
    > = new Map(),
  ) {}

  async canRead(
    ctx: TenantContext,
    courseId: string,
    principal: Principal,
  ): Promise<boolean> {
    if (isAdminPrincipal(principal)) return true;
    return (
      this.source.get(ctx.tenantId)?.get(courseId)?.has(principal.userId) ??
      false
    );
  }

  async visibleCourseIds(
    ctx: TenantContext,
    courseIds: string[],
    principal: Principal,
  ): Promise<Set<string>> {
    if (isAdminPrincipal(principal)) return new Set(courseIds);
    const byCourse = this.source.get(ctx.tenantId);
    const out = new Set<string>();
    for (const courseId of courseIds) {
      if (byCourse?.get(courseId)?.has(principal.userId)) out.add(courseId);
    }
    return out;
  }
}
