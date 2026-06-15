import { TENANT_ID } from "./auth";

/**
 * Teacher gradebook read-model: every enrolled learner's score on each
 * assignment for a single course.
 *
 * In production this comes from the grading/gradebook microservices (EPIC #44),
 * tenant-scoped via the gateway. Until that read path is wired in, we resolve a
 * small, deterministic demo gradebook for the seeded demo tenant and null for
 * everyone else, so the screen renders a real happy path, a real empty state,
 * and a real not-found state with no backend dependency.
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
  code: string;
  assignments: GradebookAssignment[];
  learners: GradebookLearner[];
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_GRADEBOOKS: Record<string, CourseGradebook> = {
  "alg-101": {
    courseId: "alg-101",
    title: "Algebra I",
    code: "ALG-101",
    assignments: [
      { id: "hw1", title: "Homework 1", points: 20 },
      { id: "qz1", title: "Quiz 1", points: 25 },
      { id: "hw2", title: "Homework 2", points: 20 },
      { id: "mid", title: "Midterm", points: 100 },
    ],
    learners: [
      {
        id: "u-ava",
        name: "Ava Nguyen",
        entries: [
          { assignmentId: "hw1", score: 19 },
          { assignmentId: "qz1", score: 23 },
          { assignmentId: "hw2", score: 18 },
          { assignmentId: "mid", score: 91 },
        ],
      },
      {
        id: "u-sam",
        name: "Sam Carter",
        entries: [
          { assignmentId: "hw1", score: 14 },
          { assignmentId: "qz1", score: 16 },
          { assignmentId: "hw2", score: null },
          { assignmentId: "mid", score: 62 },
        ],
      },
      {
        id: "u-lena",
        name: "Lena Park",
        entries: [
          { assignmentId: "hw1", score: 11 },
          { assignmentId: "qz1", score: null },
          { assignmentId: "hw2", score: null },
          { assignmentId: "mid", score: 48 },
        ],
      },
      {
        id: "u-diego",
        name: "Diego Romero",
        entries: [
          { assignmentId: "hw1", score: 20 },
          { assignmentId: "qz1", score: 22 },
          { assignmentId: "hw2", score: 19 },
          { assignmentId: "mid", score: 84 },
        ],
      },
    ],
  },
  "bio-110": {
    courseId: "bio-110",
    title: "Introduction to Biology",
    code: "BIO-110",
    assignments: [
      { id: "lab1", title: "Lab 1", points: 30 },
      { id: "qz1", title: "Quiz 1", points: 20 },
      { id: "lab2", title: "Lab 2", points: 30 },
    ],
    learners: [
      {
        id: "u-omar",
        name: "Omar Haddad",
        entries: [
          { assignmentId: "lab1", score: 24 },
          { assignmentId: "qz1", score: 13 },
          { assignmentId: "lab2", score: null },
        ],
      },
      {
        id: "u-mia",
        name: "Mia Fischer",
        entries: [
          { assignmentId: "lab1", score: 27 },
          { assignmentId: "qz1", score: 18 },
          { assignmentId: "lab2", score: 25 },
        ],
      },
      {
        id: "u-jack",
        name: "Jack Reyes",
        entries: [
          { assignmentId: "lab1", score: 12 },
          { assignmentId: "qz1", score: null },
          { assignmentId: "lab2", score: 9 },
        ],
      },
    ],
  },
  "eng-205": {
    courseId: "eng-205",
    title: "World Literature",
    code: "ENG-205",
    assignments: [
      { id: "es1", title: "Essay 1", points: 50 },
      { id: "es2", title: "Essay 2", points: 50 },
    ],
    learners: [
      {
        id: "u-zoe",
        name: "Zoe Adler",
        entries: [
          { assignmentId: "es1", score: 47 },
          { assignmentId: "es2", score: 49 },
        ],
      },
      {
        id: "u-noah",
        name: "Noah Bennett",
        entries: [
          { assignmentId: "es1", score: 44 },
          { assignmentId: "es2", score: 46 },
        ],
      },
    ],
  },
};

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
 * Resolve the gradebook for a course in the given tenant. Returns null when the
 * tenant has no seeded demo data or the course id is unknown, so the page can
 * render a not-found state.
 */
export function getCourseGradebook(
  courseId: string,
  tenantId: string = TENANT_ID,
): CourseGradebook | null {
  if (tenantId !== DEMO_TENANT_ID) return null;
  return DEMO_GRADEBOOKS[courseId] ?? null;
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
