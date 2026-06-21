/**
 * Demo dataset seed — "Wave 0" of the DB-backed bundled demo (issue #266).
 *
 * Goal: the bundled `lms` docker stack serves REAL microservice data for the two
 * demo users instead of in-memory stubs. This is a DEDICATED, idempotent seed
 * that is separate from the control-plane `seed.ts` (which is left untouched so
 * production seeding behaviour does not change).
 *
 * It is the AUTHORITY that creates the demo tenant with the FIXED uuid
 * 11111111-1111-1111-1111-111111111111 (slug "demo") and a full, internally
 * consistent dataset keyed by fixed uuids / natural keys so every wired screen
 * can later render real data. Safe to re-run: every row is upserted.
 *
 * RLS-vs-seed: the bundled Postgres role `lms` (compose POSTGRES_USER) is the DB
 * superuser, which bypasses RLS by definition — no policy is weakened. As
 * defence-in-depth the whole seed runs inside ONE transaction that first sets the
 * request-scoped `app.tenant_id` GUC, so every tenant-scoped INSERT satisfies the
 * RLS policy `WITH CHECK (tenant_id = current_tenant_id())` even if the seed role
 * were ever a non-superuser. RLS policies themselves are never touched.
 *
 * Password hashing uses @lms/auth.hashPassword — the SAME code path the Prisma
 * identity login verifies against — so login(password123) works end to end.
 */
import { hashPassword } from "@lms/auth";
import { PrismaClient } from "@prisma/client";

// ── Fixed demo UUID set (verbatim from the architect-approved design) ──────────
const T = "11111111-1111-1111-1111-111111111111"; // demo tenant
const PLAN = "d0000000-0000-0000-0000-000000000001";
const SUBSCRIPTION = "d0000000-0000-0000-0000-000000000002";
const ROOT = "d0000000-0001-0000-0000-000000000001"; // org_unit: school root
const OFFERING = "d0000000-0002-0000-0000-000000000001"; // org_unit: course-offering
const COURSE = "d0000000-0003-0000-0000-000000000001";
const SESSION = "d0000000-0004-0000-0000-000000000001"; // academic_session
const TEACHER = "d0000000-00a1-0000-0000-000000000001"; // admin@demo.school
const STUDENT = "d0000000-00a1-0000-0000-000000000002"; // student@demo.school

// Additional fixed ids for the rest of the dataset (stable across re-runs).
const ENROLL_TEACHER = "d0000000-0005-0000-0000-000000000001";
const ENROLL_STUDENT = "d0000000-0005-0000-0000-000000000002";
const ASSIGNMENT_1 = "d0000000-0006-0000-0000-000000000001";
const ASSIGNMENT_2 = "d0000000-0006-0000-0000-000000000002";
const SUBMISSION_1 = "d0000000-0007-0000-0000-000000000001";
const GRADE_SCHEME = "d0000000-0008-0000-0000-000000000001";
const GRADE_CATEGORY = "d0000000-0009-0000-0000-000000000001";
const GRADE_ITEM_1 = "d0000000-000a-0000-0000-000000000001";
const GRADE_ITEM_2 = "d0000000-000a-0000-0000-000000000002";
const GRADE_1 = "d0000000-000b-0000-0000-000000000001";
const ANNOUNCEMENT_1 = "d0000000-000c-0000-0000-000000000001";
const ANNOUNCEMENT_2 = "d0000000-000c-0000-0000-000000000002";
const FORUM = "d0000000-000d-0000-0000-000000000001";
const TOPIC = "d0000000-000e-0000-0000-000000000001";
const POST_1 = "d0000000-000f-0000-0000-000000000001";
const POST_2 = "d0000000-000f-0000-0000-000000000002";
const BELL_SCHEDULE = "d0000000-0010-0000-0000-000000000001";
const PERIOD = "d0000000-0011-0000-0000-000000000001";
const TIMETABLE = "d0000000-0012-0000-0000-000000000001";
const ATT_SESSION_1 = "d0000000-0013-0000-0000-000000000001";
const ATT_SESSION_2 = "d0000000-0013-0000-0000-000000000002";
const ATT_SESSION_3 = "d0000000-0013-0000-0000-000000000003";
const ATT_RECORD_1 = "d0000000-0014-0000-0000-000000000001";
const ATT_RECORD_2 = "d0000000-0014-0000-0000-000000000002";
const ATT_RECORD_3 = "d0000000-0014-0000-0000-000000000003";

const DEMO_PASSWORD = "password123";

// Permission catalogue mirrors the control-plane seed so scopes resolve.
const PERMISSIONS = [
  "org:manage",
  "users:manage",
  "roles:manage",
  "courses:read",
  "courses:manage",
  "content:read",
  "content:manage",
  "enrollment:orgunit:read",
  "enrollment:orgunit:manage",
  "assessment:manage",
  "grades:read",
  "grades:manage",
  "discussions:posts:read",
  "discussions:posts:manage",
  "analytics:read",
];

const ROLE_SCOPES: Record<string, string[]> = {
  instructor: [
    "courses:read",
    "courses:manage",
    "content:read",
    "content:manage",
    "assessment:manage",
    "grades:read",
    "grades:manage",
    "discussions:posts:read",
    "discussions:posts:manage",
    "enrollment:orgunit:read",
    "analytics:read",
  ],
  org_admin: [
    "org:manage",
    "users:manage",
    "roles:manage",
    "courses:read",
    "courses:manage",
    "enrollment:orgunit:read",
    "enrollment:orgunit:manage",
    "analytics:read",
  ],
  learner: [
    "courses:read",
    "content:read",
    "grades:read",
    "discussions:posts:read",
  ],
};

// Standard role set (same names the control-plane seed uses) so the demo tenant
// has the full vocabulary; assignments below only use instructor/org_admin/learner.
const STANDARD_ROLES = [
  "learner",
  "instructor",
  "teaching_assistant",
  "course_builder",
  "observer",
  "org_admin",
  "super_admin",
];

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const teacherHash = await hashPassword(DEMO_PASSWORD);
  const studentHash = await hashPassword(DEMO_PASSWORD);

  await prisma.$transaction(
    async (tx) => {
      const run = (sql: string, ...params: unknown[]): Promise<number> =>
        tx.$executeRawUnsafe(sql, ...params);

      // Defence-in-depth: scope every tenant-owned INSERT to the demo tenant so
      // the RLS WITH CHECK passes even if the seed role were non-superuser.
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true)`,
        T,
      );

      // 1. Tenant (control-plane; not RLS-scoped). Authority for the fixed id.
      // Non-destructively re-point any pre-existing 'demo' slug owned by a
      // different id (e.g. the control-plane seed's random-id tenant) so the
      // fixed-id insert below cannot hit the UNIQUE(slug) constraint. The web
      // BFF + every demo lib hard-code the fixed id, so this is the canonical one.
      await run(
        `UPDATE tenant
            SET slug = 'demo-legacy-' || left(id::text, 8)
          WHERE slug = 'demo' AND id <> $1::uuid`,
        T,
      );
      await run(
        `INSERT INTO tenant (id, slug, name, kind, tier, status, region)
         VALUES ($1::uuid, 'demo', 'Demo School', 'standalone', 'pool', 'active', 'us-east')
         ON CONFLICT (id) DO UPDATE
           SET slug = EXCLUDED.slug, name = EXCLUDED.name,
               tier = EXCLUDED.tier, status = EXCLUDED.status`,
        T,
      );

      // 2. Plan + subscription.
      await run(
        `INSERT INTO plan (id, code, name, base_price_cents, billing_model)
         VALUES ($1::uuid, 'demo', 'Demo Plan', 0, 'per_active_user')
         ON CONFLICT (id) DO UPDATE
           SET code = EXCLUDED.code, name = EXCLUDED.name`,
        PLAN,
      );
      await run(
        `INSERT INTO subscription (id, tenant_id, plan_id, status, seats, period_start, period_end)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'active', 100, now(), now() + interval '365 days')
         ON CONFLICT (id) DO UPDATE
           SET status = EXCLUDED.status, plan_id = EXCLUDED.plan_id`,
        SUBSCRIPTION,
        T,
        PLAN,
      );

      // 3. Org-unit hierarchy: root (path '{}') + course-offering (path '{root}').
      await run(
        `INSERT INTO org_unit (id, tenant_id, type, parent_id, name, code, path, is_active)
         VALUES ($1::uuid, $2::uuid, 'organization', NULL, 'Demo School', 'DEMO', '{}'::uuid[], true)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name, type = EXCLUDED.type, path = EXCLUDED.path`,
        ROOT,
        T,
      );
      await run(
        `INSERT INTO org_unit (id, tenant_id, type, parent_id, name, code, path, is_active)
         VALUES ($1::uuid, $2::uuid, 'course_offering', $3::uuid,
                 'Intro to the Demo Platform (Section A)', 'DEMO101-A',
                 ARRAY[$3::uuid]::uuid[], true)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, path = EXCLUDED.path`,
        OFFERING,
        T,
        ROOT,
      );

      // 4. App users (teacher/admin + student), active.
      await run(
        `INSERT INTO app_user (id, tenant_id, email, display_name, status, locale)
         VALUES ($1::uuid, $2::uuid, 'admin@demo.school', 'Demo Teacher', 'active', 'en')
         ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email, display_name = EXCLUDED.display_name,
               status = EXCLUDED.status`,
        TEACHER,
        T,
      );
      await run(
        `INSERT INTO app_user (id, tenant_id, email, display_name, status, locale)
         VALUES ($1::uuid, $2::uuid, 'student@demo.school', 'Demo Student', 'active', 'en')
         ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email, display_name = EXCLUDED.display_name,
               status = EXCLUDED.status`,
        STUDENT,
        T,
      );

      // 5. Local password credentials (scrypt hashes via @lms/auth).
      await run(
        `INSERT INTO user_credential (user_id, tenant_id, password_hash, algo)
         VALUES ($1::uuid, $2::uuid, $3, 'scrypt')
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        TEACHER,
        T,
        teacherHash,
      );
      await run(
        `INSERT INTO user_credential (user_id, tenant_id, password_hash, algo)
         VALUES ($1::uuid, $2::uuid, $3, 'scrypt')
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        STUDENT,
        T,
        studentHash,
      );

      // 6. Roles (by natural key tenant_id,name) — dynamic ids.
      for (const name of STANDARD_ROLES) {
        await run(
          `INSERT INTO role (tenant_id, name, is_system)
           VALUES ($1::uuid, $2, true)
           ON CONFLICT (tenant_id, name) DO NOTHING`,
          T,
          name,
        );
      }

      // 7. Permission catalogue (global) + role_permission links.
      for (const key of PERMISSIONS) {
        await run(
          `INSERT INTO permission (key) VALUES ($1)
           ON CONFLICT (key) DO NOTHING`,
          key,
        );
      }
      for (const [roleName, scopes] of Object.entries(ROLE_SCOPES)) {
        for (const key of scopes) {
          await run(
            `INSERT INTO role_permission (role_id, permission_key)
             SELECT r.id, $3 FROM role r
              WHERE r.tenant_id = $1::uuid AND r.name = $2
             ON CONFLICT (role_id, permission_key) DO NOTHING`,
            T,
            roleName,
            key,
          );
        }
      }

      // 8. Role assignments: teacher→instructor + org_admin @ root; student→learner @ offering.
      const assignRole = (
        userId: string,
        roleName: string,
        orgUnitId: string,
      ): Promise<number> =>
        run(
          `INSERT INTO role_assignment (tenant_id, user_id, role_id, org_unit_id, cascade)
           SELECT $1::uuid, $2::uuid, r.id, $4::uuid, true FROM role r
            WHERE r.tenant_id = $1::uuid AND r.name = $3
           ON CONFLICT (user_id, role_id, org_unit_id) DO NOTHING`,
          T,
          userId,
          roleName,
          orgUnitId,
        );
      await assignRole(TEACHER, "instructor", ROOT);
      await assignRole(TEACHER, "org_admin", ROOT);
      await assignRole(STUDENT, "learner", OFFERING);

      // 9. Academic session (term).
      await run(
        `INSERT INTO academic_session (id, tenant_id, title, kind, start_date, end_date)
         VALUES ($1::uuid, $2::uuid, 'Demo Term 2026', 'term', '2026-01-01', '2026-06-30')
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind`,
        SESSION,
        T,
      );

      // 10. Course (org_unit_id = offering, published).
      await run(
        `INSERT INTO course (id, tenant_id, org_unit_id, title, description, start_date, end_date, is_published)
         VALUES ($1::uuid, $2::uuid, $3::uuid,
                 'Introduction to the Demo Platform',
                 'A guided demo course covering the LMS feature set.',
                 '2026-01-01', '2026-06-30', true)
         ON CONFLICT (id) DO UPDATE
           SET title = EXCLUDED.title, description = EXCLUDED.description,
               is_published = EXCLUDED.is_published`,
        COURSE,
        T,
        OFFERING,
      );

      // 11. Enrollments x2 at the OFFERING (direct "my courses" join).
      const enroll = (
        id: string,
        userId: string,
        roleName: string,
      ): Promise<number> =>
        run(
          `INSERT INTO enrollment (id, tenant_id, user_id, org_unit_id, role_id, status)
           SELECT $1::uuid, $2::uuid, $3::uuid, $5::uuid, r.id, 'active' FROM role r
            WHERE r.tenant_id = $2::uuid AND r.name = $4
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
          id,
          T,
          userId,
          roleName,
          OFFERING,
        );
      await enroll(ENROLL_TEACHER, TEACHER, "instructor");
      await enroll(ENROLL_STUDENT, STUDENT, "learner");

      // 12. Assignments (1-2).
      await run(
        `INSERT INTO assignment (id, tenant_id, course_id, title, instructions, due_at, points, submission_type, allow_late)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Assignment 1: Introduce Yourself',
                 'Post a short introduction in the course discussion and submit a summary here.',
                 now() + interval '7 days', 100, 'text', true)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, instructions = EXCLUDED.instructions`,
        ASSIGNMENT_1,
        T,
        COURSE,
      );
      await run(
        `INSERT INTO assignment (id, tenant_id, course_id, title, instructions, due_at, points, submission_type, allow_late)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Assignment 2: Course Reflection',
                 'Write a reflection on the first module.',
                 now() + interval '14 days', 100, 'text', true)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, instructions = EXCLUDED.instructions`,
        ASSIGNMENT_2,
        T,
        COURSE,
      );

      // 13. Submission (student → assignment 1, submitted).
      await run(
        `INSERT INTO submission (id, tenant_id, assignment_id, user_id, body, status, submitted_at, is_late)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                 'Hi everyone, I am the demo student. Looking forward to the course!',
                 'submitted', now() - interval '1 day', false)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status`,
        SUBMISSION_1,
        T,
        ASSIGNMENT_1,
        STUDENT,
      );

      // 14. Gradebook: scheme + category + items + a released grade for the student.
      await run(
        `INSERT INTO grade_scheme (id, tenant_id, name, ranges)
         VALUES ($1::uuid, $2::uuid, 'Standard Letter',
                 '[{"symbol":"A","min":90},{"symbol":"B","min":80},{"symbol":"C","min":70},{"symbol":"D","min":60},{"symbol":"F","min":0}]'::jsonb)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, ranges = EXCLUDED.ranges`,
        GRADE_SCHEME,
        T,
      );
      await run(
        `INSERT INTO grade_category (id, tenant_id, course_id, name, weight, position)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Assignments', 1.000, 0)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, weight = EXCLUDED.weight`,
        GRADE_CATEGORY,
        T,
        COURSE,
      );
      await run(
        `INSERT INTO grade_item (id, tenant_id, course_id, category_id, scheme_id, name, max_points, weight, source_type, source_id, position)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'Assignment 1', 100, 0.500, 'assignment', $6::uuid, 0)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, source_id = EXCLUDED.source_id`,
        GRADE_ITEM_1,
        T,
        COURSE,
        GRADE_CATEGORY,
        GRADE_SCHEME,
        ASSIGNMENT_1,
      );
      await run(
        `INSERT INTO grade_item (id, tenant_id, course_id, category_id, scheme_id, name, max_points, weight, source_type, source_id, position)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'Assignment 2', 100, 0.500, 'assignment', $6::uuid, 1)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, source_id = EXCLUDED.source_id`,
        GRADE_ITEM_2,
        T,
        COURSE,
        GRADE_CATEGORY,
        GRADE_SCHEME,
        ASSIGNMENT_2,
      );
      await run(
        `INSERT INTO grade (id, tenant_id, grade_item_id, user_id, points, feedback, is_released, graded_by, graded_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 92, 'Great introduction — welcome aboard!', true, $5::uuid, now() - interval '12 hours')
         ON CONFLICT (id) DO UPDATE
           SET points = EXCLUDED.points, feedback = EXCLUDED.feedback,
               is_released = EXCLUDED.is_released, graded_by = EXCLUDED.graded_by`,
        GRADE_1,
        T,
        GRADE_ITEM_1,
        STUDENT,
        TEACHER,
      );

      // 15. Announcements (org_unit = offering, author = teacher, published in the past).
      await run(
        `INSERT INTO announcement (id, tenant_id, org_unit_id, author_id, title, body, publish_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Welcome to the course!',
                 'Welcome to Introduction to the Demo Platform. Check the schedule and say hello in the discussion.',
                 now() - interval '2 days')
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body`,
        ANNOUNCEMENT_1,
        T,
        OFFERING,
        TEACHER,
      );
      await run(
        `INSERT INTO announcement (id, tenant_id, org_unit_id, author_id, title, body, publish_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Assignment 1 is now open',
                 'Your first assignment is available. It is due in one week.',
                 now() - interval '1 day')
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body`,
        ANNOUNCEMENT_2,
        T,
        OFFERING,
        TEACHER,
      );

      // 16. Discussions: forum (course) → topic → posts (teacher root, student reply).
      await run(
        `INSERT INTO discussion_forum (id, tenant_id, course_id, title, position)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'General Discussion', 0)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
        FORUM,
        T,
        COURSE,
      );
      await run(
        `INSERT INTO discussion_topic (id, tenant_id, forum_id, title, description)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Introductions', 'Say hello and tell us about yourself.')
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description`,
        TOPIC,
        T,
        FORUM,
      );
      await run(
        `INSERT INTO discussion_post (id, tenant_id, topic_id, parent_id, author_id, body, is_pinned)
         VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4::uuid, 'Welcome everyone! Please introduce yourselves here.', true)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
        POST_1,
        T,
        TOPIC,
        TEACHER,
      );
      await run(
        `INSERT INTO discussion_post (id, tenant_id, topic_id, parent_id, author_id, body, is_pinned)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'Hello! Excited to be here.', false)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
        POST_2,
        T,
        TOPIC,
        POST_1,
        STUDENT,
      );

      // 17. Timetable/calendar (must precede attendance sessions that reference it).
      await run(
        `INSERT INTO bell_schedule (id, tenant_id, org_unit_id, name, timezone, is_default)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Standard Day', 'UTC', true)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        BELL_SCHEDULE,
        T,
        OFFERING,
      );
      await run(
        `INSERT INTO schedule_period (id, tenant_id, bell_schedule_id, name, sort_order, start_time, end_time, day_pattern)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Period 1', 1, '09:00', '09:50', 'daily')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
        PERIOD,
        T,
        BELL_SCHEDULE,
      );
      await run(
        `INSERT INTO timetable_entry (id, tenant_id, org_unit_id, period_id, academic_session_id, instructor_id, room, day_of_week)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 'Room 101', 1)
         ON CONFLICT (id) DO UPDATE SET room = EXCLUDED.room, instructor_id = EXCLUDED.instructor_id`,
        TIMETABLE,
        T,
        OFFERING,
        PERIOD,
        SESSION,
        TEACHER,
      );

      // 18. Attendance: codes + sessions (offering) + records (student).
      const codes: Array<[string, string, string, boolean]> = [
        ["P", "Present", "present", true],
        ["A", "Absent", "absent", false],
        ["T", "Tardy", "tardy", false],
        ["EX", "Excused", "excused", false],
      ];
      for (const [code, label, category, isDefault] of codes) {
        await run(
          `INSERT INTO attendance_code (tenant_id, code, label, category, is_default)
           VALUES ($1::uuid, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          T,
          code,
          label,
          category,
          isDefault,
        );
      }
      const attSession = (
        id: string,
        date: string,
        status: string,
      ): Promise<number> =>
        run(
          `INSERT INTO attendance_session (id, tenant_id, org_unit_id, timetable_entry_id, meeting_date, period_label, status, taken_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, 'Period 1', $6, $7::uuid)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
          id,
          T,
          OFFERING,
          TIMETABLE,
          date,
          status,
          TEACHER,
        );
      await attSession(ATT_SESSION_1, "2026-02-02", "finalized");
      await attSession(ATT_SESSION_2, "2026-02-03", "finalized");
      await attSession(ATT_SESSION_3, "2026-02-04", "open");

      const attRecord = (
        id: string,
        sessionId: string,
        code: string,
        minutesLate: number | null,
      ): Promise<number> =>
        run(
          `INSERT INTO attendance_record (id, tenant_id, session_id, user_id, code, minutes_late, recorded_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid)
           ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, minutes_late = EXCLUDED.minutes_late`,
          id,
          T,
          sessionId,
          STUDENT,
          code,
          minutesLate,
          TEACHER,
        );
      await attRecord(ATT_RECORD_1, ATT_SESSION_1, "P", null);
      await attRecord(ATT_RECORD_2, ATT_SESSION_2, "T", 5);
      await attRecord(ATT_RECORD_3, ATT_SESSION_3, "P", null);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  // Report row counts under the demo tenant (fresh tenant-scoped transaction).
  const counts = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, T);
    const tables = [
      "app_user",
      "user_credential",
      "role",
      "role_assignment",
      "course",
      "enrollment",
      "assignment",
      "submission",
      "grade",
      "announcement",
      "discussion_post",
      "attendance_record",
      "timetable_entry",
    ];
    const out: Record<string, number> = {};
    for (const table of tables) {
      const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1::uuid`,
        T,
      );
      out[table] = Number(rows[0]?.n ?? 0);
    }
    return out;
  });

  // eslint-disable-next-line no-console
  console.log(
    `Demo seed complete for tenant ${T}\n` +
      `  teacher admin@demo.school = ${TEACHER}\n` +
      `  student student@demo.school = ${STUDENT}\n` +
      `  row counts (tenant-scoped): ${JSON.stringify(counts)}`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
