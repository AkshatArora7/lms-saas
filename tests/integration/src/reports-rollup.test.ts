import { randomUUID } from "node:crypto";

import { createPrismaStore as createAnalyticsStore } from "@lms/service-analytics/dist/store.prisma.js";
import type { TenantContext } from "@lms/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminPool,
  appPoolUrl,
  createTenant,
  dbAvailable,
  ensureSchemaAndRole,
  type PgPool,
} from "./helpers/db.js";

/**
 * Issue #269 — the admin /reports screen needs real per-school rollups. The
 * analytics service's `listOrgUnitRollups` aggregates the tenant's existing
 * domain tables (org_unit subtree, course, enrollment, attendance, grade) under
 * RLS via withTenant.
 *
 * This lane seeds a complete school subtree as the admin (superuser, for
 * fixtures), then runs the REAL analytics Prisma store through @lms/db's pool
 * pointed at the NON-superuser app role so RLS genuinely applies — proving the
 * aggregation is correct AND tenant-scoped. Skipped when DATABASE_URL is unset.
 */
describe.skipIf(!dbAvailable)("analytics reporting rollups: school subtree aggregate under RLS", () => {
  let admin: PgPool;
  let tenant: string;
  let ctx: TenantContext;

  const savedDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await ensureSchemaAndRole();
    admin = adminPool();
    tenant = await createTenant(admin, `rollup-${randomUUID()}`, "Rollup U");

    // School (organization) + a course-offering under it (path = [school]).
    const school = await admin.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, type, name, code, path)
       VALUES ($1, 'organization', 'North High School', 'NHS', '{}'::uuid[])
       RETURNING id`,
      [tenant],
    );
    const schoolId = school.rows[0]!.id;
    const offering = await admin.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, type, parent_id, name, code, path)
       VALUES ($1, 'course_offering', $2, 'Algebra I - A', 'ALG-A', ARRAY[$2::uuid])
       RETURNING id`,
      [tenant, schoolId],
    );
    const offeringId = offering.rows[0]!.id;

    // Course at the offering.
    const course = await admin.query<{ id: string }>(
      `INSERT INTO course (tenant_id, org_unit_id, title, is_published)
       VALUES ($1, $2, 'Algebra I', true) RETURNING id`,
      [tenant, offeringId],
    );
    const courseId = course.rows[0]!.id;

    // Role + two learners enrolled at the offering.
    const role = await admin.query<{ id: string }>(
      `INSERT INTO role (tenant_id, name) VALUES ($1, 'learner') RETURNING id`,
      [tenant],
    );
    const roleId = role.rows[0]!.id;
    const userIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const u = await admin.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, email, display_name, status)
         VALUES ($1, $2, 'Learner', 'active') RETURNING id`,
        [tenant, `learner-${i}-${randomUUID()}@rollup.test`],
      );
      userIds.push(u.rows[0]!.id);
      await admin.query(
        `INSERT INTO enrollment (tenant_id, user_id, org_unit_id, role_id, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [tenant, u.rows[0]!.id, offeringId, roleId],
      );
    }

    // Attendance: codes + a session + 2 records (1 present, 1 absent → 50%).
    await admin.query(
      `INSERT INTO attendance_code (tenant_id, code, label, category, is_default)
       VALUES ($1,'P','Present','present',true), ($1,'A','Absent','absent',false)`,
      [tenant],
    );
    const session = await admin.query<{ id: string }>(
      `INSERT INTO attendance_session (tenant_id, org_unit_id, meeting_date, period_label, status)
       VALUES ($1, $2, '2026-02-02', 'P1', 'finalized') RETURNING id`,
      [tenant, offeringId],
    );
    const sessionId = session.rows[0]!.id;
    await admin.query(
      `INSERT INTO attendance_record (tenant_id, session_id, user_id, code)
       VALUES ($1, $2, $3, 'P'), ($1, $2, $4, 'A')`,
      [tenant, sessionId, userIds[0], userIds[1]],
    );

    // Gradebook: a grade item (max 100) + one released grade of 90.
    const item = await admin.query<{ id: string }>(
      `INSERT INTO grade_item (tenant_id, course_id, name, max_points)
       VALUES ($1, $2, 'Quiz 1', 100) RETURNING id`,
      [tenant, courseId],
    );
    await admin.query(
      `INSERT INTO grade (tenant_id, grade_item_id, user_id, points, is_released, graded_at)
       VALUES ($1, $2, $3, 90, true, now())`,
      [tenant, item.rows[0]!.id, userIds[0]],
    );

    // Point @lms/db's pool at the non-superuser app role so RLS applies.
    process.env.DATABASE_URL = appPoolUrl();
    ctx = { tenantId: tenant, tier: "pool", databaseUrl: appPoolUrl() };
  });

  afterAll(async () => {
    if (admin) {
      await admin.query("DELETE FROM tenant WHERE id = $1", [tenant]);
      await admin.end();
    }
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  it("rolls up the school subtree (course/enrollment/attendance/grade)", async () => {
    const store = createAnalyticsStore();
    const rollups = await store.listOrgUnitRollups(ctx);

    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({
      name: "North High School",
      code: "NHS",
      courseCount: 1,
      enrollmentCount: 2,
      attendanceRate: 50, // 1 present of 2 records
      averageGrade: 90, // 90 / 100 * 100
    });
  });

  it("isolates tenants: a foreign tenant context sees no rollups", async () => {
    const store = createAnalyticsStore();
    const foreign: TenantContext = {
      tenantId: randomUUID(),
      tier: "pool",
      databaseUrl: appPoolUrl(),
    };
    expect(await store.listOrgUnitRollups(foreign)).toEqual([]);
  });
});
