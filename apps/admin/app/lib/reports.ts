import { TENANT_ID } from "./auth";

/**
 * District roll-up reporting data for the admin console.
 *
 * In production this comes from the analytics service's precomputed read models
 * (Caliper/LRS, EPIC #59), scoped to the administrator's district subtree and
 * respecting sub-tenant isolation. Until that read path is wired in, we resolve
 * a small, deterministic demo set for the seeded demo tenant and an empty
 * collection for everyone else, so the screen renders a real happy path and a
 * real empty state with no backend dependency.
 */

export interface SchoolRollup {
  id: string;
  name: string;
  students: number;
  /** Mean course-completion percentage across the school, 0-100. */
  completion: number;
  /** Mean engagement across the school, 0-100. */
  engagement: number;
  /** Count of learners currently flagged at risk. */
  atRisk: number;
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_SCHOOLS: SchoolRollup[] = [
  {
    id: "north-high",
    name: "North High School",
    students: 412,
    completion: 81,
    engagement: 74,
    atRisk: 23,
  },
  {
    id: "west-elementary",
    name: "West Elementary",
    students: 286,
    completion: 88,
    engagement: 79,
    atRisk: 9,
  },
  {
    id: "east-middle",
    name: "East Middle School",
    students: 354,
    completion: 72,
    engagement: 65,
    atRisk: 41,
  },
  {
    id: "south-academy",
    name: "South Academy",
    students: 198,
    completion: 90,
    engagement: 84,
    atRisk: 6,
  },
];

export interface RollupSummary {
  schoolCount: number;
  totalStudents: number;
  /** Enrollment-weighted mean completion across schools, rounded. */
  avgCompletion: number;
  totalAtRisk: number;
}

/**
 * Resolve the per-school roll-up rows for the given tenant's district. Returns
 * an empty array (driving the empty state) for tenants without seeded data.
 */
export function getSchoolRollups(tenantId: string = TENANT_ID): SchoolRollup[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_SCHOOLS : [];
}

/** Derive the district-level headline summary across schools. */
export function summarizeRollups(schools: SchoolRollup[]): RollupSummary {
  if (!schools.length) {
    return {
      schoolCount: 0,
      totalStudents: 0,
      avgCompletion: 0,
      totalAtRisk: 0,
    };
  }
  const totalStudents = schools.reduce((sum, s) => sum + s.students, 0);
  const weightedCompletion = schools.reduce(
    (sum, s) => sum + s.completion * s.students,
    0,
  );
  return {
    schoolCount: schools.length,
    totalStudents,
    avgCompletion: totalStudents
      ? Math.round(weightedCompletion / totalStudents)
      : 0,
    totalAtRisk: schools.reduce((sum, s) => sum + s.atRisk, 0),
  };
}
