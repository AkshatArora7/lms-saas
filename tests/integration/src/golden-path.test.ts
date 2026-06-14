import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminPool,
  appPool,
  createTenant,
  dbAvailable,
  ensureSchemaAndRole,
  withGuc,
  type PgPool,
} from "./helpers/db.js";

/**
 * Cross-service golden path exercised against the real schema within a single
 * tenant, under RLS (app role + GUC). It walks the data contract shared by the
 * control-plane, user-org, course, and enrollment services:
 *
 *   tenant -> org_unit + role + app_user -> course (course svc) ->
 *   enrollment (enrollment svc) -> roster read (enrollment svc query)
 *
 * Then it proves a second tenant sees none of it — isolation holds across the
 * whole golden path, not just one table. Skipped when DATABASE_URL is unset.
 */
describe.skipIf(!dbAvailable)("Golden path: provision a course and enrol a student", () => {
  let admin: PgPool;
  let app: PgPool;
  let tenant: string;
  let otherTenant: string;
  let orgUnitId: string;
  let studentId: string;

  beforeAll(async () => {
    await ensureSchemaAndRole();
    admin = adminPool();
    app = appPool();

    tenant = await createTenant(admin, `gp-${randomUUID()}`, "Golden Path U");
    otherTenant = await createTenant(admin, `gp-other-${randomUUID()}`, "Other U");

    // Seed the user-org domain (org unit, role, student) for the tenant.
    const ou = await admin.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, type, name)
       VALUES ($1, 'course_offering', 'CS101 - Fall') RETURNING id`,
      [tenant],
    );
    orgUnitId = ou.rows[0]!.id;

    await admin.query(
      `INSERT INTO role (tenant_id, name) VALUES ($1, 'student')`,
      [tenant],
    );

    const user = await admin.query<{ id: string }>(
      `INSERT INTO app_user (tenant_id, email, display_name, status)
       VALUES ($1, $2, 'Sam Student', 'active') RETURNING id`,
      [tenant, `sam-${randomUUID()}@gp.test`],
    );
    studentId = user.rows[0]!.id;
  });

  afterAll(async () => {
    if (admin) {
      await admin.query("DELETE FROM tenant WHERE id = ANY($1::uuid[])", [
        [tenant, otherTenant],
      ]);
      await admin.end();
    }
    if (app) await app.end();
  });

  it("creates a course, enrols the student, and the roster reflects it", async () => {
    const result = await withGuc(app, tenant, async (c) => {
      // Course service: create the course for the org unit.
      const course = await c.query<{ id: string; title: string }>(
        `INSERT INTO course (tenant_id, org_unit_id, title, is_published)
         VALUES ($1, $2, 'Intro to CS', true)
         RETURNING id, title`,
        [tenant, orgUnitId],
      );

      // Enrollment service: resolve the role then enrol the student.
      const role = await c.query<{ id: string }>(
        `SELECT id FROM role WHERE name = 'student' LIMIT 1`,
      );
      const enrollment = await c.query<{ id: string }>(
        `INSERT INTO enrollment (tenant_id, user_id, org_unit_id, role_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant, studentId, orgUnitId, role.rows[0]!.id],
      );

      // Enrollment service: read the active roster (the store's joined query).
      const roster = await c.query<{
        user_id: string;
        role: string;
        status: string;
      }>(
        `SELECT e.user_id, r.name AS role, e.status
           FROM enrollment e
           LEFT JOIN role r ON r.id = e.role_id
          WHERE e.org_unit_id = $1 AND e.status = 'active'
          ORDER BY e.enrolled_at`,
        [orgUnitId],
      );

      return { course: course.rows[0]!, enrollmentId: enrollment.rows[0]!.id, roster: roster.rows };
    });

    expect(result.course.title).toBe("Intro to CS");
    expect(result.enrollmentId).toBeTruthy();
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0]!.user_id).toBe(studentId);
    expect(result.roster[0]!.role).toBe("student");
  });

  it("isolates the whole golden path from another tenant", async () => {
    const seen = await withGuc(app, otherTenant, async (c) => {
      const courses = await c.query(
        "SELECT id FROM course WHERE org_unit_id = $1",
        [orgUnitId],
      );
      const roster = await c.query(
        `SELECT e.id FROM enrollment e WHERE e.org_unit_id = $1`,
        [orgUnitId],
      );
      return { courses: courses.rowCount, roster: roster.rowCount };
    });

    expect(seen.courses).toBe(0);
    expect(seen.roster).toBe(0);
  });
});
