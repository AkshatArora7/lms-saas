import type { Session } from "./auth";

/**
 * Tenant settings model for the admin tenant settings screen.
 *
 * The tenant `tier` from the session maps directly to the hybrid tenancy model:
 * `pool` tenants share the database with row-level-security isolation, while
 * `silo` tenants get a dedicated database/branch. In production the full tenant
 * record (region, data residency, connection reference) comes from the tenant
 * service; until that read path is wired in, we interpret the session's tier
 * here so the screen renders a faithful happy path with no backend dependency.
 */

export type TenancyModel = "pool" | "silo";

export interface TenancyInfo {
  model: TenancyModel;
  label: string;
  summary: string;
  isolation: string;
}

export interface TenantSettings {
  tenantId: string;
  tier: string;
  tenancy: TenancyInfo;
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

/** Build the tenant settings view from the current session. */
export function getTenantSettings(session: Session): TenantSettings {
  return {
    tenantId: session.tenantId,
    tier: session.tier,
    tenancy: tenancyForTier(session.tier),
  };
}
