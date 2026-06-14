import { TENANT_ID } from "./auth";

/**
 * Dashboard data for the learner home.
 *
 * In production these come from the enrollment + course microservices (via the
 * gateway, tenant-scoped). Until that read path is wired into this surface, we
 * resolve a small, deterministic set of demo courses for the seeded demo tenant
 * and an empty collection for everyone else, so the dashboard renders a real
 * happy path and a real empty state with no backend dependency.
 */
export interface DashboardCourse {
  id: string;
  title: string;
  code: string;
  term: string;
  /** 0-100 completion percentage. */
  progress: number;
  /** The learner's role in this course, shown as a chip. */
  role: string;
}

/** The kind of a content item within a module. */
export type ContentItemType = "lesson" | "assignment" | "quiz";

/** The learner's completion state for a content item. */
export type ContentItemStatus = "completed" | "in_progress" | "not_started";

export interface ContentItem {
  id: string;
  title: string;
  type: ContentItemType;
  status: ContentItemStatus;
}

export interface CourseModule {
  id: string;
  title: string;
  items: ContentItem[];
}

export interface CourseDetail extends DashboardCourse {
  instructor: string;
  description: string;
  modules: CourseModule[];
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_COURSES: DashboardCourse[] = [
  { id: "alg-101", title: "Algebra I", code: "ALG-101", term: "Fall 2026", progress: 62, role: "student" },
  { id: "bio-110", title: "Introduction to Biology", code: "BIO-110", term: "Fall 2026", progress: 38, role: "student" },
  { id: "eng-205", title: "World Literature", code: "ENG-205", term: "Fall 2026", progress: 85, role: "student" },
  { id: "his-150", title: "Modern World History", code: "HIS-150", term: "Fall 2026", progress: 12, role: "student" },
];

/**
 * Resolve the courses to show on the learner dashboard for the given tenant.
 * Returns an empty array (driving the empty state) for tenants without seeded
 * demo data.
 */
export function getDashboardCourses(
  tenantId: string = TENANT_ID,
): DashboardCourse[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_COURSES : [];
}

const DEMO_COURSE_DETAILS: Record<string, CourseDetail> = {
  "alg-101": {
    id: "alg-101",
    title: "Algebra I",
    code: "ALG-101",
    term: "Fall 2026",
    progress: 62,
    role: "student",
    instructor: "Dr. Priya Natarajan",
    description:
      "Foundations of algebra: expressions, linear equations, functions, and an introduction to quadratics.",
    modules: [
      {
        id: "alg-101-m1",
        title: "Expressions & Variables",
        items: [
          { id: "alg-101-m1-l1", title: "What is a variable?", type: "lesson", status: "completed" },
          { id: "alg-101-m1-l2", title: "Simplifying expressions", type: "lesson", status: "completed" },
          { id: "alg-101-m1-a1", title: "Problem set 1", type: "assignment", status: "completed" },
        ],
      },
      {
        id: "alg-101-m2",
        title: "Linear Equations",
        items: [
          { id: "alg-101-m2-l1", title: "Solving one-step equations", type: "lesson", status: "completed" },
          { id: "alg-101-m2-l2", title: "Solving multi-step equations", type: "lesson", status: "in_progress" },
          { id: "alg-101-m2-q1", title: "Linear equations quiz", type: "quiz", status: "not_started" },
        ],
      },
      {
        id: "alg-101-m3",
        title: "Functions",
        items: [
          { id: "alg-101-m3-l1", title: "Intro to functions", type: "lesson", status: "not_started" },
          { id: "alg-101-m3-a1", title: "Graphing assignment", type: "assignment", status: "not_started" },
        ],
      },
    ],
  },
  "bio-110": {
    id: "bio-110",
    title: "Introduction to Biology",
    code: "BIO-110",
    term: "Fall 2026",
    progress: 38,
    role: "student",
    instructor: "Mr. Daniel Okoro",
    description:
      "An introductory survey of cell biology, genetics, and ecology with weekly lab activities.",
    modules: [
      {
        id: "bio-110-m1",
        title: "The Cell",
        items: [
          { id: "bio-110-m1-l1", title: "Cell structure", type: "lesson", status: "completed" },
          { id: "bio-110-m1-l2", title: "Membranes & transport", type: "lesson", status: "in_progress" },
          { id: "bio-110-m1-q1", title: "Cell biology quiz", type: "quiz", status: "not_started" },
        ],
      },
      {
        id: "bio-110-m2",
        title: "Genetics",
        items: [
          { id: "bio-110-m2-l1", title: "DNA & replication", type: "lesson", status: "not_started" },
          { id: "bio-110-m2-a1", title: "Punnett square lab", type: "assignment", status: "not_started" },
        ],
      },
    ],
  },
  "eng-205": {
    id: "eng-205",
    title: "World Literature",
    code: "ENG-205",
    term: "Fall 2026",
    progress: 85,
    role: "student",
    instructor: "Ms. Aisha Rahman",
    description:
      "A reading of major works across cultures and eras, with a focus on close reading and analytical writing.",
    modules: [
      {
        id: "eng-205-m1",
        title: "Epic & Myth",
        items: [
          { id: "eng-205-m1-l1", title: "The Odyssey", type: "lesson", status: "completed" },
          { id: "eng-205-m1-a1", title: "Hero's journey essay", type: "assignment", status: "completed" },
        ],
      },
      {
        id: "eng-205-m2",
        title: "The Modern Novel",
        items: [
          { id: "eng-205-m2-l1", title: "Narrative voice", type: "lesson", status: "completed" },
          { id: "eng-205-m2-l2", title: "Theme & symbolism", type: "lesson", status: "in_progress" },
          { id: "eng-205-m2-q1", title: "Final reflection", type: "quiz", status: "not_started" },
        ],
      },
    ],
  },
  "his-150": {
    id: "his-150",
    title: "Modern World History",
    code: "HIS-150",
    term: "Fall 2026",
    progress: 12,
    role: "student",
    instructor: "Dr. Marcus Bell",
    description:
      "From the industrial revolution to the present: revolutions, world wars, and globalization.",
    modules: [
      {
        id: "his-150-m1",
        title: "Industrial Revolution",
        items: [
          { id: "his-150-m1-l1", title: "Causes of industrialization", type: "lesson", status: "in_progress" },
          { id: "his-150-m1-l2", title: "Social impact", type: "lesson", status: "not_started" },
          { id: "his-150-m1-a1", title: "Source analysis", type: "assignment", status: "not_started" },
        ],
      },
    ],
  },
};

/**
 * Resolve a single course's detail for the given tenant. Returns null for
 * tenants without seeded demo data or for unknown course ids, driving the
 * not-found path.
 */
export function getCourseDetail(
  courseId: string,
  tenantId: string = TENANT_ID,
): CourseDetail | null {
  if (tenantId !== DEMO_TENANT_ID) return null;
  return DEMO_COURSE_DETAILS[courseId] ?? null;
}
