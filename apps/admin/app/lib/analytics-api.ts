import { TENANT_ID } from "./auth";

/**
 * Server-only client for the analytics microservice.
 *
 * BFF read boundary for the admin /reports screen: forwards the authenticated
 * tenant as `x-tenant-id` (the trusted header the gateway injects in production
 * and the analytics resolver expects), so all reporting stays tenant-scoped.
 * The `/reports/org-units` rollup is a tenant-scoped read across the existing
 * domain tables (enrollment, course, attendance, grade) — analytics is the
 * reporting bounded context. Reads return `null` on failure so the Server
 * Component renders a clean empty/offline state with no demo fallback.
 */

export const ANALYTICS_SERVICE_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:4015";

/** One reporting row per `organization` org unit (a "school"). */
export interface OrgUnitRollup {
  orgUnitId: string;
  name: string;
  code: string | null;
  /** Courses anywhere in this org unit's subtree. */
  courseCount: number;
  /** Enrollment rows (all roles) anywhere in this org unit's subtree. */
  enrollmentCount: number;
  /** Share of attendance marked present, 0-100 (1 dp); null when none recorded. */
  attendanceRate: number | null;
  /** Mean released grade as a percentage, 0-100 (1 dp); null when none released. */
  averageGrade: number | null;
}

/** District-level headline across all org-unit rollups. */
export interface RollupSummary {
  orgUnitCount: number;
  courseCount: number;
  enrollmentCount: number;
  attendanceRate: number | null;
  averageGrade: number | null;
}

export interface OrgUnitReport {
  orgUnits: OrgUnitRollup[];
  summary: RollupSummary;
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/**
 * Fetch the per-school reporting rollups + district summary for the tenant.
 * Returns `null` when the analytics service is unreachable or errors, so the
 * page renders a clean empty/offline state.
 */
export async function getOrgUnitReport(
  tenantId: string = TENANT_ID,
): Promise<OrgUnitReport | null> {
  try {
    const res = await fetch(`${ANALYTICS_SERVICE_URL}/reports/org-units`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OrgUnitReport;
  } catch {
    return null;
  }
}
