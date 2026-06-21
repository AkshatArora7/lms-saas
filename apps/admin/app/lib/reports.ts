import { TENANT_ID } from "./auth";
import {
  getOrgUnitReport,
  type OrgUnitReport,
  type OrgUnitRollup,
  type RollupSummary,
} from "./analytics-api";

/**
 * District roll-up reporting data for the admin console, sourced live from the
 * analytics service's `/reports/org-units` endpoint (a tenant-scoped read across
 * enrollment / course / attendance / grade). One row per `organization` org unit
 * (a "school") plus a district-level summary. Returns an empty report when the
 * service is unreachable, driving a clean empty/offline state with no demo
 * fallback.
 */

export type { OrgUnitRollup, RollupSummary, OrgUnitReport };

const EMPTY_REPORT: OrgUnitReport = {
  orgUnits: [],
  summary: {
    orgUnitCount: 0,
    courseCount: 0,
    enrollmentCount: 0,
    attendanceRate: null,
    averageGrade: null,
  },
};

/** Resolve the per-school rollups + summary for the tenant's district. */
export async function getReport(
  tenantId: string = TENANT_ID,
): Promise<OrgUnitReport> {
  return (await getOrgUnitReport(tenantId)) ?? EMPTY_REPORT;
}

