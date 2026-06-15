import { TENANT_ID } from "./auth";

/**
 * Gradebook data for the learner grades screen.
 *
 * In production this comes from the grading/gradebook microservices (EPIC #44),
 * tenant-scoped via the gateway. Until that read path is wired in, we resolve a
 * small, deterministic set of demo grades for the seeded demo tenant and an
 * empty collection for everyone else, so the screen renders a real happy path
 * and a real empty state with no backend dependency.
 */

export interface GradeCategory {
  name: string;
  /** Weight of this category toward the final grade, 0-100. */
  weight: number;
  /** The learner's score in this category, 0-100. */
  score: number;
}

export interface CourseGrade {
  courseId: string;
  title: string;
  code: string;
  /** Overall course percentage, 0-100. */
  percent: number;
  letter: string;
  categories: GradeCategory[];
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_GRADES: CourseGrade[] = [
  {
    courseId: "alg-101",
    title: "Algebra I",
    code: "ALG-101",
    percent: 88,
    letter: "B+",
    categories: [
      { name: "Homework", weight: 30, score: 92 },
      { name: "Quizzes", weight: 30, score: 84 },
      { name: "Exams", weight: 40, score: 88 },
    ],
  },
  {
    courseId: "bio-110",
    title: "Introduction to Biology",
    code: "BIO-110",
    percent: 76,
    letter: "C+",
    categories: [
      { name: "Labs", weight: 40, score: 80 },
      { name: "Quizzes", weight: 25, score: 70 },
      { name: "Exams", weight: 35, score: 74 },
    ],
  },
  {
    courseId: "eng-205",
    title: "World Literature",
    code: "ENG-205",
    percent: 94,
    letter: "A",
    categories: [
      { name: "Essays", weight: 50, score: 95 },
      { name: "Participation", weight: 20, score: 96 },
      { name: "Exams", weight: 30, score: 91 },
    ],
  },
];

export interface GradesSummary {
  courseCount: number;
  /** Mean course percentage across graded courses, rounded; null when none. */
  average: number | null;
}

/**
 * Resolve the graded courses to show for the given tenant. Returns an empty
 * array (driving the empty state) for tenants without seeded demo data.
 */
export function getCourseGrades(tenantId: string = TENANT_ID): CourseGrade[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_GRADES : [];
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
