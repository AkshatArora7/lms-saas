import { TENANT_ID } from "./auth";
import { getUserEnrollments, getRoster } from "./enrollment-api";
import { listCourses, type Course } from "./courses-api";

/**
 * Teaching data for the instructor dashboard, sourced live from the enrollment
 * and course microservices via the BFF server-fetch pattern (tenant-scoped with
 * `x-tenant-id`). We read the instructor's own enrollments, keep the ones whose
 * role is a teaching role, join each to its course, and count the learners on
 * that course's roster. Returns `[]` when the instructor teaches nothing or a
 * service is unreachable, driving a clean empty/offline state with no demo
 * fallback.
 *
 * Identifier note (mirrors enrolled.ts): an enrollment is keyed by the course
 * OFFERING (`orgUnitId`), which is also how the roster is addressed; the course
 * row exposes both its own `id` (assignment / discussion / grading / gradebook)
 * and its `orgUnitId` (announcement / timetable / roster). We carry both so the
 * teacher screens can address the right service.
 *
 * Engagement and at-risk read models (analytics, EPIC #59) have no live read
 * path yet, so they are intentionally NOT surfaced here rather than faked.
 */

export interface TaughtCourse {
  /** The course row id — key for assignment / discussion / grading services. */
  courseId: string;
  /** The course offering / org unit — key for announcement / calendar / roster. */
  orgUnitId: string;
  title: string;
  /** Count of learners enrolled in this course. */
  enrolled: number;
}

export interface TeachingSummary {
  courseCount: number;
  totalEnrolled: number;
}

/** Roles that grant access to the instructor dashboard (from the session). */
export const TEACHER_ROLES = ["instructor", "teacher", "org_admin"];

/** Enrollment roles that mean the user TEACHES (rather than learns) a course. */
const TEACHING_ENROLLMENT_ROLES = [
  "instructor",
  "teacher",
  "teaching_assistant",
];

/**
 * Resolve the courses the given user teaches for the tenant, ordered by title.
 * Returns `[]` when there are no teaching enrollments or a service is
 * unreachable.
 */
export async function getTaughtCourses(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<TaughtCourse[]> {
  const [enrollments, courses] = await Promise.all([
    getUserEnrollments(userId, tenantId),
    listCourses(tenantId),
  ]);
  if (!enrollments.length || !courses.length) return [];

  const byOrgUnit = new Map<string, Course>();
  for (const course of courses) {
    byOrgUnit.set(course.orgUnitId, course);
  }

  const teaching = enrollments.filter(
    (e) =>
      TEACHING_ENROLLMENT_ROLES.includes(e.role) &&
      e.status !== "withdrawn" &&
      e.status !== "inactive",
  );

  const resolved = await Promise.all(
    teaching.map(async (enrollment): Promise<TaughtCourse | null> => {
      const course = byOrgUnit.get(enrollment.orgUnitId);
      if (!course) return null;
      // Roster is addressed by the OFFERING (org unit), not the course row id.
      const roster = await getRoster(course.orgUnitId, tenantId);
      const enrolled = roster.ok
        ? roster.roster.filter((r) => r.role === "learner").length
        : 0;
      return {
        courseId: course.id,
        orgUnitId: course.orgUnitId,
        title: course.title,
        enrolled,
      };
    }),
  );

  return resolved
    .filter((c): c is TaughtCourse => c !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Derive the headline counts shown above the teaching dashboard. */
export function summarizeTeaching(courses: TaughtCourse[]): TeachingSummary {
  return {
    courseCount: courses.length,
    totalEnrolled: courses.reduce((sum, c) => sum + c.enrolled, 0),
  };
}

/**
 * Resolve a single course the user teaches, addressed by its COURSE row id
 * (the value the teacher routes carry as `[courseId]`). Returns `null` when the
 * user does not teach that course, so inner teacher screens can render a
 * not-found state and stay authorization-scoped. The returned record carries
 * both `courseId` (assignment / discussion / grading) and `orgUnitId`
 * (announcement / roster / calendar) so callers address the right service.
 */
export async function getTaughtCourse(
  userId: string,
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<TaughtCourse | null> {
  const courses = await getTaughtCourses(userId, tenantId);
  return courses.find((c) => c.courseId === courseId) ?? null;
}

/** Whether the given roles can access the instructor dashboard. */
export function canTeach(roles: string[]): boolean {
  return roles.some((r) => TEACHER_ROLES.includes(r));
}
