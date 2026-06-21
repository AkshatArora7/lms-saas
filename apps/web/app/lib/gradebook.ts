import { TENANT_ID } from "./auth";
import { getCourse } from "./courses-api";
import { getRoster } from "./enrollment-api";
import { getGradebook } from "./grading-api";
import { getUser } from "./user-org-api";

/**
 * Teacher gradebook read-model: every enrolled learner's score on each
 * assignment for a single course, sourced live from the grading microservice
 * (EPIC #44) via the BFF server-fetch pattern (tenant-scoped with
 * `x-tenant-id`). We read the course's grade items (the assignments) and grades
 * from grading, the learner roster from enrollment (keyed by the course's org
 * unit), and the learner display names from user-org, then build the matrix.
 * Returns `null` only when the course id is unknown (driving a not-found state);
 * a reachable course with no items/learners renders a real empty gradebook.
 */

export interface GradebookAssignment {
  id: string;
  title: string;
  /** Maximum attainable points for this assignment. */
  points: number;
}

export interface GradebookEntry {
  assignmentId: string;
  /** Points earned, or null when the learner has not submitted / is unmarked. */
  score: number | null;
}

export interface GradebookLearner {
  id: string;
  name: string;
  entries: GradebookEntry[];
}

export interface CourseGradebook {
  courseId: string;
  title: string;
  /** Course code — not modelled by the course service yet, hence nullable. */
  code: string | null;
  assignments: GradebookAssignment[];
  learners: GradebookLearner[];
}

export interface LearnerSummary {
  /** Earned points across graded (non-null) assignments. */
  earned: number;
  /** Possible points across graded (non-null) assignments. */
  possible: number;
  /** Rounded percentage across graded assignments, or null when none graded. */
  percent: number | null;
  /** Count of assignments with no submitted/marked score. */
  missing: number;
}

export interface AssignmentSummary {
  /** Mean percentage across learners who have a score, or null when none. */
  classAverage: number | null;
  /** How many learners have a graded score for this assignment. */
  graded: number;
}

export interface GradebookSummary {
  learnerCount: number;
  assignmentCount: number;
  /** Number of cells with a graded score. */
  gradedCells: number;
  /** Total gradeable cells (learners x assignments). */
  totalCells: number;
  /** Mean of every graded cell percentage, or null when nothing is graded. */
  classAverage: number | null;
}

/**
 * Resolve the live gradebook for a course in the given tenant. Returns `null`
 * when the course id is unknown (the page renders a not-found state). A course
 * with no grade items or no learners returns an empty-but-valid gradebook so the
 * page renders a real empty state rather than 404-ing.
 */
export async function getCourseGradebook(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<CourseGradebook | null> {
  const course = await getCourse(courseId, tenantId);
  if (!course) return null;

  const [gradebook, roster] = await Promise.all([
    getGradebook(courseId, tenantId),
    // The roster is addressed by the course OFFERING (org unit), not the row id.
    getRoster(course.orgUnitId, tenantId),
  ]);

  const assignments: GradebookAssignment[] = (gradebook?.items ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ id: item.id, title: item.name, points: item.maxPoints }));

  // Index grades by `${userId}:${gradeItemId}` for O(1) cell lookup.
  const scoreByKey = new Map<string, number | null>();
  for (const grade of gradebook?.grades ?? []) {
    scoreByKey.set(`${grade.userId}:${grade.gradeItemId}`, grade.points);
  }

  const learnerEnrollments = roster.ok
    ? roster.roster.filter((r) => r.role === "learner")
    : [];

  const learners: GradebookLearner[] = await Promise.all(
    learnerEnrollments.map(async (enrollment): Promise<GradebookLearner> => {
      const user = await getUser(enrollment.userId, tenantId);
      const entries: GradebookEntry[] = assignments.map((a) => {
        const key = `${enrollment.userId}:${a.id}`;
        return {
          assignmentId: a.id,
          score: scoreByKey.has(key) ? (scoreByKey.get(key) ?? null) : null,
        };
      });
      return {
        id: enrollment.userId,
        name: user?.displayName ?? "Unknown learner",
        entries,
      };
    }),
  );
  learners.sort((a, b) => a.name.localeCompare(b.name));

  return {
    courseId: course.id,
    title: course.title,
    code: null,
    assignments,
    learners,
  };
}

function pointsFor(gradebook: CourseGradebook): Map<string, number> {
  return new Map(gradebook.assignments.map((a) => [a.id, a.points]));
}

/** Per-learner earned/possible/percent/missing across graded assignments. */
export function summarizeLearner(
  learner: GradebookLearner,
  gradebook: CourseGradebook,
): LearnerSummary {
  const points = pointsFor(gradebook);
  let earned = 0;
  let possible = 0;
  let missing = 0;
  for (const entry of learner.entries) {
    const max = points.get(entry.assignmentId) ?? 0;
    if (entry.score === null) {
      missing += 1;
      continue;
    }
    earned += entry.score;
    possible += max;
  }
  return {
    earned,
    possible,
    percent: possible > 0 ? Math.round((earned / possible) * 100) : null,
    missing,
  };
}

/** Per-assignment class average percentage and graded count. */
export function summarizeAssignment(
  assignment: GradebookAssignment,
  gradebook: CourseGradebook,
): AssignmentSummary {
  let sum = 0;
  let graded = 0;
  for (const learner of gradebook.learners) {
    const entry = learner.entries.find(
      (e) => e.assignmentId === assignment.id,
    );
    if (!entry || entry.score === null) continue;
    if (assignment.points > 0) {
      sum += (entry.score / assignment.points) * 100;
    }
    graded += 1;
  }
  return {
    classAverage: graded > 0 ? Math.round(sum / graded) : null,
    graded,
  };
}

/** Headline counts shown above the gradebook grid. */
export function summarizeGradebook(gradebook: CourseGradebook): GradebookSummary {
  const points = pointsFor(gradebook);
  let gradedCells = 0;
  let percentSum = 0;
  for (const learner of gradebook.learners) {
    for (const entry of learner.entries) {
      if (entry.score === null) continue;
      const max = points.get(entry.assignmentId) ?? 0;
      if (max > 0) {
        percentSum += (entry.score / max) * 100;
        gradedCells += 1;
      }
    }
  }
  const totalCells = gradebook.learners.length * gradebook.assignments.length;
  return {
    learnerCount: gradebook.learners.length,
    assignmentCount: gradebook.assignments.length,
    gradedCells,
    totalCells,
    classAverage: gradedCells > 0 ? Math.round(percentSum / gradedCells) : null,
  };
}
