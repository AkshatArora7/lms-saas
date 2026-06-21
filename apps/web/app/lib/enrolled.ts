import { TENANT_ID } from "./auth";
import { getUserEnrollments } from "./enrollment-api";
import { listCourses, type Course } from "./courses-api";

/**
 * Resolve the learner's enrolled courses by joining the enrollment service to
 * the course service. This is the shared building block for every learner
 * screen that is "per enrolled course" (dashboard, grades, assignments,
 * announcements, schedule).
 *
 * Identifier note: an enrollment is keyed by the course OFFERING (`orgUnitId`),
 * while the course row exposes both its own `id` (used by assignment /
 * discussion / grading) and its `orgUnitId` (used by announcement / timetable).
 * We carry both so each caller can address the right service.
 */

export interface EnrolledCourse {
  /** The course row id — key for assignment / discussion / grading services. */
  courseId: string;
  /** The course offering / org unit — key for announcement / calendar. */
  orgUnitId: string;
  title: string;
  description: string | null;
  /** The learner's role in this course (from the enrollment). */
  role: string;
  /** Enrollment status: active / completed / withdrawn / inactive. */
  status: string;
}

/**
 * Resolve the learner's active enrolled courses, ordered by title. Returns `[]`
 * when there are no enrollments or a service is unreachable, driving a clean
 * empty/offline state with no demo fallback.
 */
export async function getEnrolledCourses(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<EnrolledCourse[]> {
  const [enrollments, courses] = await Promise.all([
    getUserEnrollments(userId, tenantId),
    listCourses(tenantId),
  ]);
  if (!enrollments.length || !courses.length) return [];

  const byOrgUnit = new Map<string, Course>();
  for (const course of courses) {
    byOrgUnit.set(course.orgUnitId, course);
  }

  const resolved: EnrolledCourse[] = [];
  for (const enrollment of enrollments) {
    if (enrollment.status === "withdrawn" || enrollment.status === "inactive") {
      continue;
    }
    const course = byOrgUnit.get(enrollment.orgUnitId);
    if (!course) continue;
    resolved.push({
      courseId: course.id,
      orgUnitId: course.orgUnitId,
      title: course.title,
      description: course.description,
      role: enrollment.role,
      status: enrollment.status,
    });
  }

  return resolved.sort((a, b) => a.title.localeCompare(b.title));
}
