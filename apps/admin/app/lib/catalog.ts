import { TENANT_ID } from "./auth";

/**
 * Course catalogue read-model for the admin console.
 *
 * In production these come from the course/enrollment microservices
 * (EPIC #44 / area/courses), tenant-scoped via the gateway. Until that read path
 * is wired in, we resolve a small, deterministic catalogue for the seeded demo
 * tenant and an empty list for everyone else, so the screen renders a real happy
 * path and a real empty state with no backend dependency.
 */

export type CourseStatus = "active" | "draft" | "archived";

export interface CatalogueCourse {
  id: string;
  title: string;
  code: string;
  term: string;
  instructor: string;
  enrolled: number;
  status: CourseStatus;
}

export interface CatalogueSummary {
  total: number;
  active: number;
  totalEnrolled: number;
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_CATALOGUE: CatalogueCourse[] = [
  {
    id: "alg-101",
    title: "Algebra I",
    code: "ALG-101",
    term: "Fall 2026",
    instructor: "Ms. Carter",
    enrolled: 28,
    status: "active",
  },
  {
    id: "bio-110",
    title: "Introduction to Biology",
    code: "BIO-110",
    term: "Fall 2026",
    instructor: "Mr. Osei",
    enrolled: 31,
    status: "active",
  },
  {
    id: "eng-205",
    title: "World Literature",
    code: "ENG-205",
    term: "Fall 2026",
    instructor: "Mrs. Nguyen",
    enrolled: 24,
    status: "active",
  },
  {
    id: "his-150",
    title: "World History",
    code: "HIST-150",
    term: "Fall 2026",
    instructor: "Mr. Dlamini",
    enrolled: 26,
    status: "active",
  },
  {
    id: "cs-101",
    title: "Intro to Computer Science",
    code: "CS-101",
    term: "Spring 2027",
    instructor: "Dr. Park",
    enrolled: 0,
    status: "draft",
  },
  {
    id: "art-090",
    title: "Foundations of Studio Art",
    code: "ART-090",
    term: "Spring 2027",
    instructor: "Ms. Rivera",
    enrolled: 0,
    status: "draft",
  },
  {
    id: "chem-210",
    title: "Organic Chemistry",
    code: "CHEM-210",
    term: "Spring 2025",
    instructor: "Dr. Adebayo",
    enrolled: 22,
    status: "archived",
  },
];

const STATUS_VALUES: CourseStatus[] = ["active", "draft", "archived"];

/** Whether a query-string value is a valid course status filter. */
export function isCourseStatus(value: string): value is CourseStatus {
  return (STATUS_VALUES as string[]).includes(value);
}

/**
 * Resolve the tenant's course catalogue. Returns an empty array (driving the
 * empty state) for tenants without seeded demo data.
 */
export function getCatalogue(tenantId: string = TENANT_ID): CatalogueCourse[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_CATALOGUE : [];
}

/** Filter the catalogue by status; an undefined filter returns everything. */
export function filterCatalogue(
  courses: CatalogueCourse[],
  status?: CourseStatus,
): CatalogueCourse[] {
  return status ? courses.filter((c) => c.status === status) : courses;
}

/** Headline counts shown above the catalogue (always over the full set). */
export function summarizeCatalogue(
  courses: CatalogueCourse[],
): CatalogueSummary {
  return {
    total: courses.length,
    active: courses.filter((c) => c.status === "active").length,
    totalEnrolled: courses.reduce((sum, c) => sum + c.enrolled, 0),
  };
}
