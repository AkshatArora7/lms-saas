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
 * Options describing the distinct, non-trivial subtree to seed for one tenant.
 * Distinct counts per tenant make cross-tenant contamination show up as a wrong
 * NUMBER (not just a wrong id), which is what makes the RLS proof meaningful.
 */
interface SeedOpts {
  schoolName: string;
  schoolCode: string;
  courseTitle: string;
  /** How many learners to create + enroll at the offering. */
  learnerCount: number;
  /**
   * One attendance_record per entry, mapped to learners by index. 'P' (present)
   * and 'A' (absent) → attendanceRate = present / total * 100.
   */
  attendance: ("P" | "A")[];
  /** Points (out of max_points 100) for a single released grade on learner 0. */
  gradePoints: number;
}

interface SeededSubtree {
  schoolId: string;
  offeringId: string;
  courseId: string;
  roleId: string;
  userIds: string[];
}

/**
 * Seed one tenant's complete rollup subtree as the admin (superuser, so fixtures
 * bypass RLS and set `tenant_id` directly). Returns the created ids. Extracted
 * from the original inline seed so the single-tenant suite and the two-tenant
 * isolation suite exercise identical seed logic (DRY). #267 uuid=text discipline:
 * cast ONLY uuid columns (e.g. `ARRAY[$2::uuid]`), never blanket-cast.
 */
async function seedTenantSubtree(
  admin: PgPool,
  tenantId: string,
  opts: SeedOpts,
): Promise<SeededSubtree> {
  // School (organization) + a course-offering under it (path = [school]).
  const school = await admin.query<{ id: string }>(
    `INSERT INTO org_unit (tenant_id, type, name, code, path)
     VALUES ($1, 'organization', $2, $3, '{}'::uuid[])
     RETURNING id`,
    [tenantId, opts.schoolName, opts.schoolCode],
  );
  const schoolId = school.rows[0]!.id;
  const offering = await admin.query<{ id: string }>(
    `INSERT INTO org_unit (tenant_id, type, parent_id, name, code, path)
     VALUES ($1, 'course_offering', $2, $3, $4, ARRAY[$2::uuid])
     RETURNING id`,
    [tenantId, schoolId, `${opts.courseTitle} - A`, `${opts.schoolCode}-ALG-A`],
  );
  const offeringId = offering.rows[0]!.id;

  // Course at the offering.
  const course = await admin.query<{ id: string }>(
    `INSERT INTO course (tenant_id, org_unit_id, title, is_published)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [tenantId, offeringId, opts.courseTitle],
  );
  const courseId = course.rows[0]!.id;

  // Role + learners enrolled at the offering.
  const role = await admin.query<{ id: string }>(
    `INSERT INTO role (tenant_id, name) VALUES ($1, 'learner') RETURNING id`,
    [tenantId],
  );
  const roleId = role.rows[0]!.id;
  const userIds: string[] = [];
  for (let i = 0; i < opts.learnerCount; i += 1) {
    const u = await admin.query<{ id: string }>(
      `INSERT INTO app_user (tenant_id, email, display_name, status)
       VALUES ($1, $2, 'Learner', 'active') RETURNING id`,
      [tenantId, `learner-${i}-${randomUUID()}@rollup.test`],
    );
    userIds.push(u.rows[0]!.id);
    await admin.query(
      `INSERT INTO enrollment (tenant_id, user_id, org_unit_id, role_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [tenantId, u.rows[0]!.id, offeringId, roleId],
    );
  }

  // Attendance: codes + a session + one record per `opts.attendance` entry.
  await admin.query(
    `INSERT INTO attendance_code (tenant_id, code, label, category, is_default)
     VALUES ($1,'P','Present','present',true), ($1,'A','Absent','absent',false)`,
    [tenantId],
  );
  const session = await admin.query<{ id: string }>(
    `INSERT INTO attendance_session (tenant_id, org_unit_id, meeting_date, period_label, status)
     VALUES ($1, $2, '2026-02-02', 'P1', 'finalized') RETURNING id`,
    [tenantId, offeringId],
  );
  const sessionId = session.rows[0]!.id;
  for (let i = 0; i < opts.attendance.length; i += 1) {
    await admin.query(
      `INSERT INTO attendance_record (tenant_id, session_id, user_id, code)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, sessionId, userIds[i], opts.attendance[i]],
    );
  }

  // Gradebook: a grade item (max 100) + one released grade for learner 0.
  const item = await admin.query<{ id: string }>(
    `INSERT INTO grade_item (tenant_id, course_id, name, max_points)
     VALUES ($1, $2, 'Quiz 1', 100) RETURNING id`,
    [tenantId, courseId],
  );
  await admin.query(
    `INSERT INTO grade (tenant_id, grade_item_id, user_id, points, is_released, graded_at)
     VALUES ($1, $2, $3, $4, true, now())`,
    [tenantId, item.rows[0]!.id, userIds[0], opts.gradePoints],
  );

  return { schoolId, offeringId, courseId, roleId, userIds };
}

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

    // Seed a complete school subtree: 1 course, 2 enrollments, attendance of
    // 1-present-of-2 (50%), and one released grade of 90.
    await seedTenantSubtree(admin, tenant, {
      schoolName: "North High School",
      schoolCode: "NHS",
      courseTitle: "Algebra I",
      learnerCount: 2,
      attendance: ["P", "A"],
      gradePoints: 90,
    });

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

/**
 * Issue #280 — prove the /reports/org-units rollup is isolated by live Postgres
 * RLS, not app-level filtering. The store's ROLLUP_SQL has NO tenant_id predicate
 * (services/analytics/src/store.prisma.ts:120-156) — scoping is purely RLS + the
 * `app.tenant_id` GUC set by withTenant.
 *
 * Two tenants A and B are both seeded with REAL, DISTINCT subtrees (different
 * enrollment counts, attendance rates, and grades) so a cross-tenant leak shows
 * up as a WRONG NUMBER, not merely a wrong id. Running the real store under the
 * non-superuser `lms_rls_app` role (appPoolUrl), each tenant's context must see
 * ONLY its own rows. A superuser cross-check (which BYPASSes RLS) confirms both
 * tenants' rows physically coexist — so the separation is RLS, not seeding.
 */
describe.skipIf(!dbAvailable)(
  "analytics reporting rollups: RLS isolation between two seeded tenants",
  () => {
    let admin: PgPool;
    let tenantA: string;
    let tenantB: string;
    let schoolA: string;
    let schoolB: string;
    let ctxA: TenantContext;
    let ctxB: TenantContext;

    const savedDatabaseUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      await ensureSchemaAndRole();
      admin = adminPool();

      tenantA = await createTenant(admin, `rollup-a-${randomUUID()}`, "Rollup A");
      tenantB = await createTenant(admin, `rollup-b-${randomUUID()}`, "Rollup B");

      // Tenant A: 2 enrollments, attendance 1-present-of-2 (50%), grade 90.
      const a = await seedTenantSubtree(admin, tenantA, {
        schoolName: "Tenant A High",
        schoolCode: "TA-HS",
        courseTitle: "Algebra I",
        learnerCount: 2,
        attendance: ["P", "A"],
        gradePoints: 90,
      });
      schoolA = a.schoolId;

      // Tenant B: 3 enrollments, attendance 2-present-of-2 (100%), grade 80.
      const b = await seedTenantSubtree(admin, tenantB, {
        schoolName: "Tenant B High",
        schoolCode: "TB-HS",
        courseTitle: "Biology I",
        learnerCount: 3,
        attendance: ["P", "P"],
        gradePoints: 80,
      });
      schoolB = b.schoolId;

      // Run the real store via the NON-superuser app role so RLS applies. Running
      // as superuser would BYPASS RLS and make the isolation assertion vacuous.
      process.env.DATABASE_URL = appPoolUrl();
      ctxA = { tenantId: tenantA, tier: "pool", databaseUrl: appPoolUrl() };
      ctxB = { tenantId: tenantB, tier: "pool", databaseUrl: appPoolUrl() };
    });

    afterAll(async () => {
      if (admin) {
        await admin.query("DELETE FROM tenant WHERE id = ANY($1::uuid[])", [
          [tenantA, tenantB],
        ]);
        await admin.end();
      }
      if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDatabaseUrl;
    });

    it("under tenant A's context: sees only A's rows with A's numbers", async () => {
      const store = createAnalyticsStore();
      const rollups = await store.listOrgUnitRollups(ctxA);

      const ids = rollups.map((r) => r.orgUnitId);
      expect(ids).toContain(schoolA);
      expect(ids).not.toContain(schoolB);

      const rowA = rollups.find((r) => r.orgUnitId === schoolA);
      expect(rowA).toMatchObject({
        name: "Tenant A High",
        code: "TA-HS",
        courseCount: 1,
        enrollmentCount: 2,
        attendanceRate: 50,
        averageGrade: 90,
      });
    });

    it("under tenant B's context: sees only B's rows with B's numbers (no A leak)", async () => {
      const store = createAnalyticsStore();
      const rollups = await store.listOrgUnitRollups(ctxB);

      const ids = rollups.map((r) => r.orgUnitId);
      expect(ids).toContain(schoolB);
      expect(ids).not.toContain(schoolA);

      const rowB = rollups.find((r) => r.orgUnitId === schoolB);
      // B's OWN numbers — not A's, and not A+B combined. A leak of A's subtree
      // would change enrollmentCount/attendanceRate/averageGrade here.
      expect(rowB).toMatchObject({
        name: "Tenant B High",
        code: "TB-HS",
        courseCount: 1,
        enrollmentCount: 3,
        attendanceRate: 100,
        averageGrade: 80,
      });
    });

    it("superuser (BYPASS RLS) sees BOTH tenants' organizations coexisting", async () => {
      // The admin pool is a superuser, so RLS does not apply (no GUC needed). This
      // proves both A's and B's rows physically coexist in one table — i.e. the
      // isolation observed above is RLS, not a silent seed failure or empty tenant.
      const res = await admin.query<{ id: string }>(
        `SELECT id FROM org_unit WHERE type = 'organization'`,
      );
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(schoolA);
      expect(ids).toContain(schoolB);
    });
  },
);
