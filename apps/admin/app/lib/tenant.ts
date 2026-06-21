import { TENANT_ID } from "./auth";
import {
  getTenant,
  getTenantGovernance,
} from "./tenant-api";

/**
 * Tenant settings model for the admin tenant settings screen, sourced live from
 * the tenant (control-plane) microservice. The tenant `tier` maps to the hybrid
 * tenancy model: `pool` tenants share the database with row-level-security
 * isolation, while `silo` tenants get a dedicated database/branch. The tier,
 * status, plan, name and region all come from the tenant registry; the tenancy
 * copy below is generic explanation of each model, not tenant-specific data.
 */

export type TenancyModel = "pool" | "silo";

export interface TenancyInfo {
  model: TenancyModel;
  label: string;
  summary: string;
  isolation: string;
}

export interface TenantOverview {
  tenantId: string;
  name: string;
  slug: string;
  tier: string;
  status: string;
  plan: string | null;
  region: string;
  tenancy: TenancyInfo;
  /** Effective governance settings (catalog defaults overlaid with overrides). */
  settings: Record<string, unknown>;
}

const POOL: TenancyInfo = {
  model: "pool",
  label: "Pool (shared)",
  summary:
    "This tenant shares a database with other tenants. It is the default, most cost-efficient model and scales to many tenants per database.",
  isolation:
    "Data is isolated by tenant_id with PostgreSQL Row-Level Security — every query is automatically scoped to this tenant.",
};

const SILO: TenancyInfo = {
  model: "silo",
  label: "Silo (dedicated)",
  summary:
    "This tenant runs in its own dedicated database/branch, chosen for stricter isolation, data-residency, or scale requirements.",
  isolation:
    "Data lives in a database that holds only this tenant. The same schema and RLS policies apply, so pool to silo migration is a no-op.",
};

/** Interpret a tenant tier string as a tenancy model, defaulting to pool. */
export function tenancyForTier(tier: string): TenancyInfo {
  return tier.toLowerCase() === "silo" ? SILO : POOL;
}

/**
 * Resolve the live tenant overview from the tenant service. Returns `null` when
 * the tenant is unknown or the service is unreachable, so the page renders a
 * clean offline state rather than fabricating tenancy details.
 */
export async function getTenantOverview(
  tenantId: string = TENANT_ID,
): Promise<TenantOverview | null> {
  const [tenant, governance] = await Promise.all([
    getTenant(tenantId),
    getTenantGovernance(tenantId),
  ]);
  if (!tenant) return null;
  return {
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    tier: tenant.tier,
    status: tenant.status,
    plan: tenant.planId,
    region: tenant.region,
    tenancy: tenancyForTier(tenant.tier),
    settings: governance?.settings ?? {},
  };
}
