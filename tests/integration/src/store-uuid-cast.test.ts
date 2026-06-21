import { randomUUID } from "node:crypto";

import { createPrismaStore as createAnnouncementStore } from "@lms/service-announcement/dist/store.prisma.js";
import { createPrismaStore as createAssignmentStore } from "@lms/service-assignment/dist/store.prisma.js";
import { createPrismaStore as createDiscussionStore } from "@lms/service-discussion/dist/store.prisma.js";
import { createPrismaStore as createEnrollmentStore } from "@lms/service-enrollment/dist/store.prisma.js";
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
 * Regression guard for issue #267: tenant-scoped Prisma raw-SQL stores bound JS
 * string params against `uuid` columns with NO `::uuid` cast, so Postgres threw
 * `42883 operator does not exist: uuid = text` on every tenant-scoped read. Unit
 * tests never caught it because they run with `*_STORE=memory`, never touching
 * the Prisma/Postgres path.
 *
 * This lane exercises the REAL `createPrismaStore` of the affected services
 * through `@lms/db.withTenant()` against a live Postgres — the exact code path
 * the BFF hits. Prisma binds string args as `text`, so a missing `::uuid` cast
 * makes any of the reads below throw 42883 and fail this test. We route
 * `@lms/db`'s pool at the NON-superuser app role (via DATABASE_URL) so RLS
 * genuinely applies — proving the casts work AND tenant scoping is intact.
 *
 * Skipped when DATABASE_URL is unset (e.g. local runs without the compose stack).
 */
describe.skipIf(!dbAvailable)("Prisma store uuid casts: create+read round-trips (no uuid = text)", () => {
  let admin: PgPool;
  let tenant: string;
  let orgUnitId: string;
  let courseId: string;
  let userId: string;
  let ctx: TenantContext;

  const savedDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await ensureSchemaAndRole();
    admin = adminPool();

    tenant = await createTenant(admin, `uuidcast-${randomUUID()}`, "UUID Cast U");

    // Seed the parent rows the stores reference. The admin pool is a superuser
    // (bypasses RLS), which is fine for fixture setup — the stores under test
    // run as the non-superuser app role below.
    const ou = await admin.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, type, name)
       VALUES ($1, 'course_offering', 'CS101 - Fall') RETURNING id`,
      [tenant],
    );
    orgUnitId = ou.rows[0]!.id;

    await admin.query(`INSERT INTO role (tenant_id, name) VALUES ($1, 'student')`, [
      tenant,
    ]);

    const user = await admin.query<{ id: string }>(
      `INSERT INTO app_user (tenant_id, email, display_name, status)
       VALUES ($1, $2, 'Sam Student', 'active') RETURNING id`,
      [tenant, `sam-${randomUUID()}@uuidcast.test`],
    );
    userId = user.rows[0]!.id;

    const course = await admin.query<{ id: string }>(
      `INSERT INTO course (tenant_id, org_unit_id, title, is_published)
       VALUES ($1, $2, 'Intro to CS', true) RETURNING id`,
      [tenant, orgUnitId],
    );
    courseId = course.rows[0]!.id;

    // Point @lms/db's shared pool (used by every store's withTenant) at the
    // non-superuser app role so FORCE ROW LEVEL SECURITY genuinely applies.
    process.env.DATABASE_URL = appPoolUrl();
    ctx = { tenantId: tenant, tier: "pool", databaseUrl: appPoolUrl() };
  });

  afterAll(async () => {
    if (admin) {
      // tenant ON DELETE CASCADE removes course/assignment/enrollment/etc.
      await admin.query("DELETE FROM tenant WHERE id = $1", [tenant]);
      await admin.end();
    }
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  it("assignment store: create then read by id and by course_id", async () => {
    const store = createAssignmentStore();

    const created = await store.createAssignment(ctx, {
      courseId,
      title: "Homework 1",
      submissionType: "text",
    });
    expect(created.id).toBeTruthy();

    // WHERE id = $1::uuid — threw 42883 before the fix.
    const byId = await store.getAssignment(ctx, created.id);
    expect(byId?.id).toBe(created.id);

    // WHERE course_id = $1::uuid — threw 42883 before the fix.
    const byCourse = await store.listAssignments(ctx, courseId);
    expect(byCourse.some((a) => a.id === created.id)).toBe(true);

    // submission insert + read (assignment_id = $1::uuid).
    const submitted = await store.submit(ctx, created.id, { userId, body: "answer" });
    expect(submitted.ok).toBe(true);
    const subs = await store.listSubmissions(ctx, created.id);
    expect(subs.some((s) => s.userId === userId)).toBe(true);
  });

  it("enrollment store: enrol then read by id, roster, and user", async () => {
    const store = createEnrollmentStore();

    const created = await store.createEnrollment(ctx, {
      userId,
      orgUnitId,
      role: "student",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(`enrol failed: ${created.reason}`);

    // WHERE e.id = $1::uuid (joined query) — threw 42883 before the fix.
    const byId = await store.getEnrollment(ctx, created.enrollment.id);
    expect(byId?.id).toBe(created.enrollment.id);

    // WHERE e.org_unit_id = $1::uuid — threw 42883 before the fix.
    const roster = await store.getRoster(ctx, orgUnitId);
    expect(roster.some((e) => e.userId === userId)).toBe(true);

    // WHERE e.user_id = $1::uuid — threw 42883 before the fix.
    const forUser = await store.listForUser(ctx, userId);
    expect(forUser.some((e) => e.id === created.enrollment.id)).toBe(true);
  });

  it("announcement store: create then read by id and org_unit", async () => {
    const store = createAnnouncementStore();

    const created = await store.create(ctx, {
      orgUnitId,
      authorId: userId,
      title: "Welcome",
      body: "First day reminders.",
    });
    expect(created.id).toBeTruthy();

    // WHERE id = $1::uuid — threw 42883 before the fix.
    const byId = await store.get(ctx, created.id);
    expect(byId?.id).toBe(created.id);

    // WHERE org_unit_id = $1::uuid — threw 42883 before the fix.
    const list = await store.listForOrgUnit(ctx, orgUnitId);
    expect(list.some((a) => a.id === created.id)).toBe(true);
  });

  it("discussion store: forum/topic/post create then read by uuid fks", async () => {
    const store = createDiscussionStore();

    // INSERT ... course_id = $2::uuid (subquery) + RETURNING.
    const forum = await store.createForum(ctx, { courseId, title: "General" });
    expect(forum.id).toBeTruthy();

    // WHERE course_id = $1::uuid — threw 42883 before the fix.
    const forums = await store.listForums(ctx, courseId);
    expect(forums.some((f) => f.id === forum.id)).toBe(true);

    // WHERE forum_id = $1::uuid lookups inside createTopic + listTopics.
    const topic = await store.createTopic(ctx, forum.id, { title: "Week 1" });
    expect(topic?.id).toBeTruthy();
    const topics = await store.listTopics(ctx, forum.id);
    expect(topics.some((t) => t.id === topic!.id)).toBe(true);

    // topic_id = $1::uuid lookups inside createPost + listPosts + getThread.
    const post = await store.createPost(ctx, topic!.id, {
      authorId: userId,
      body: "Hello class",
    });
    expect(post.ok).toBe(true);
    if (!post.ok) throw new Error(`post failed: ${post.reason}`);

    const posts = await store.listPosts(ctx, topic!.id);
    expect(posts.some((p) => p.id === post.post.id)).toBe(true);

    const thread = await store.getThread(ctx, topic!.id);
    expect(thread.some((node) => node.id === post.post.id)).toBe(true);
  });
});
