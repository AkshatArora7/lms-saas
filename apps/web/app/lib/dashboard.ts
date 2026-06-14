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
