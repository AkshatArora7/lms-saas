import { TENANT_ID } from "./auth";
import { getEnrolledCourses } from "./enrolled";
import { getStudentGrades, getGradebook } from "./grading-api";

/**
 * Gradebook data for the learner grades screen, sourced live from the grading
 * microservice via the BFF server-fetch pattern (tenant-scoped with
 * `x-tenant-id`). For each enrolled course we read the learner's released
 * grades + projected final, and the gradebook metadata (item names/weights) to
 * label the breakdown. Courses with no released grades are omitted, driving a
 * real empty state with no demo fallback.
 */

export interface GradeCategory {
  name: string;
  /** Weight of this item toward the final grade, 0-100. */
  weight: number;
  /** The learner's score on this item, 0-100. */
  score: number;
}

export interface CourseGrade {
  courseId: string;
  title: string;
  /** Course code — not modelled by the course service yet, hence nullable. */
  code: string | null;
  /** Overall course percentage, 0-100. */
  percent: number;
  letter: string;
  categories: GradeCategory[];
}

/**
 * Resolve the learner's released grades per enrolled course. Returns `[]`
 * (driving the empty state) when no course has a released grade or a service is
 * unreachable.
 */
export async function getCourseGrades(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<CourseGrade[]> {
  const enrolled = await getEnrolledCourses(userId, tenantId);
  const results = await Promise.all(
    enrolled.map(async (course): Promise<CourseGrade | null> => {
      const [student, gradebook] = await Promise.all([
        getStudentGrades(course.courseId, userId, tenantId),
        getGradebook(course.courseId, tenantId),
      ]);
      if (!student) return null;

      const itemsById = new Map(
        (gradebook?.items ?? []).map((item) => [item.id, item]),
      );
      const categories: GradeCategory[] = student.grades
        .filter((g) => g.points !== null)
        .map((g) => {
          const item = itemsById.get(g.gradeItemId);
          const max = item?.maxPoints ?? 100;
          const score = max > 0 ? Math.round(((g.points ?? 0) / max) * 100) : 0;
          return {
            name: item?.name ?? "Grade",
            weight: item?.weight != null ? Math.round(item.weight * 100) : 0,
            score,
          };
        });

      // Only surface a course once at least one grade has been released.
      if (!categories.length) return null;

      return {
        courseId: course.courseId,
        title: course.title,
        code: null,
        percent: Math.round(student.projected.percent),
        letter: student.projected.symbol ?? "—",
        categories,
      };
    }),
  );
  return results.filter((g): g is CourseGrade => g !== null);
}

export interface GradesSummary {
  courseCount: number;
  /** Mean course percentage across graded courses, rounded; null when none. */
  average: number | null;
}

/** Derive the headline summary shown above the grades list. */
export function summarizeGrades(grades: CourseGrade[]): GradesSummary {
  if (!grades.length) return { courseCount: 0, average: null };
  const total = grades.reduce((sum, g) => sum + g.percent, 0);
  return {
    courseCount: grades.length,
    average: Math.round(total / grades.length),
  };
}
