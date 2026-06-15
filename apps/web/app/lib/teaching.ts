import { TENANT_ID } from "./auth";

/**
 * Teaching read-model data for the instructor engagement dashboard.
 *
 * In production these come from the analytics service's precomputed read models
 * (Caliper/LRS, EPIC #59), tenant-scoped via the gateway. Until that read path
 * is wired in, we resolve a small, deterministic demo set for the seeded demo
 * tenant and an empty collection for everyone else, so the dashboard renders a
 * real happy path and a real empty state with no backend dependency.
 */

/** A coarse engagement band derived from recent activity. */
export type RiskLevel = "on_track" | "at_risk" | "critical";

export interface AtRiskLearner {
  id: string;
  name: string;
  risk: RiskLevel;
  /** Short human-readable reason for the flag. */
  reason: string;
}

export interface TaughtCourse {
  id: string;
  title: string;
  code: string;
  enrolled: number;
  /** Mean engagement across enrolled learners, 0-100. */
  engagement: number;
  atRisk: AtRiskLearner[];
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_TAUGHT: TaughtCourse[] = [
  {
    id: "alg-101",
    title: "Algebra I",
    code: "ALG-101",
    enrolled: 28,
    engagement: 74,
    atRisk: [
      { id: "u-sam", name: "Sam Carter", risk: "at_risk", reason: "No activity in 6 days" },
      { id: "u-lena", name: "Lena Park", risk: "critical", reason: "3 missing assignments" },
    ],
  },
  {
    id: "bio-110",
    title: "Introduction to Biology",
    code: "BIO-110",
    enrolled: 31,
    engagement: 61,
    atRisk: [
      { id: "u-omar", name: "Omar Haddad", risk: "at_risk", reason: "Quiz scores trending down" },
      { id: "u-mia", name: "Mia Fischer", risk: "at_risk", reason: "No activity in 4 days" },
      { id: "u-jack", name: "Jack Reyes", risk: "critical", reason: "Below 50% overall" },
    ],
  },
  {
    id: "eng-205",
    title: "World Literature",
    code: "ENG-205",
    enrolled: 24,
    engagement: 88,
    atRisk: [],
  },
];

export interface TeachingSummary {
  courseCount: number;
  totalEnrolled: number;
  atRiskCount: number;
}

/** Roles that grant access to the instructor dashboard. */
export const TEACHER_ROLES = ["instructor", "teacher", "org_admin"];

/**
 * Resolve the courses taught by the current user for the given tenant. Returns
 * an empty array (driving the empty state) for tenants without seeded demo data.
 */
export function getTaughtCourses(tenantId: string = TENANT_ID): TaughtCourse[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_TAUGHT : [];
}

/** Derive the headline counts shown above the teaching dashboard. */
export function summarizeTeaching(courses: TaughtCourse[]): TeachingSummary {
  return {
    courseCount: courses.length,
    totalEnrolled: courses.reduce((sum, c) => sum + c.enrolled, 0),
    atRiskCount: courses.reduce((sum, c) => sum + c.atRisk.length, 0),
  };
}

/** Whether the given roles can access the instructor dashboard. */
export function canTeach(roles: string[]): boolean {
  return roles.some((r) => TEACHER_ROLES.includes(r));
}
