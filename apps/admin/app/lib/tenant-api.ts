import { TENANT_ID } from "./auth";

/**
 * Server-only client for the tenant (control-plane) microservice.
 *
 * BFF read boundary for the admin /settings and /branding screens: the tenant
 * registry, governance settings, and white-label branding for the current
 * tenant. The tenant registry surface is a control plane (no `x-tenant-id`
 * resolver) addressed by tenant id in the path; we still forward `x-tenant-id`
 * for parity with the other clients. Reads return `null` on failure so the
 * Server Component renders a clean empty/offline state with no demo fallback.
 */

export const TENANT_SERVICE_URL =
  process.env.TENANT_SERVICE_URL ?? "http://localhost:4002";

export type TenantTier = "pool" | "silo";
export type TenantStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "deleted";
export type TenantKind = "standalone" | "parent" | "sub";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  kind: TenantKind;
  parentId: string | null;
  tier: TenantTier;
  status: TenantStatus;
  region: string;
  planId: string | null;
  subdomain: string;
  createdAt: string;
  updatedAt: string;
}

export type BrandingTheme = "light" | "dark" | "system";

/** Effective (inheritance-resolved) white-label branding for a tenant. */
export interface TenantBranding {
  tenantId: string;
  displayName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  theme: BrandingTheme;
  customDomain: string | null;
  customCss: string | null;
  supportEmail: string | null;
  inheritParent: boolean;
  updatedAt: string | null;
}

export interface BrandingResponse {
  /** Effective branding (own row with NULLs filled from ancestors). */
  branding: TenantBranding;
  /** The tenant's OWN overrides (no inheritance), or null when unset. */
  overrides: TenantBranding | null;
}

export interface TenantSettingsResponse {
  /** Effective governance settings (catalog defaults overlaid with overrides). */
  settings: Record<string, unknown>;
  /** Stored overrides only. */
  overrides: Record<string, unknown>;
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/** Fetch the tenant registry record. Returns `null` when missing/unreachable. */
export async function getTenant(
  tenantId: string = TENANT_ID,
): Promise<Tenant | null> {
  try {
    const res = await fetch(
      `${TENANT_SERVICE_URL}/tenants/${encodeURIComponent(tenantId)}`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tenant: Tenant };
    return data.tenant ?? null;
  } catch {
    return null;
  }
}

/** Fetch the tenant's effective branding + own overrides. `null` on failure. */
export async function getTenantBranding(
  tenantId: string = TENANT_ID,
): Promise<BrandingResponse | null> {
  try {
    const res = await fetch(
      `${TENANT_SERVICE_URL}/tenants/${encodeURIComponent(tenantId)}/branding`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as BrandingResponse;
  } catch {
    return null;
  }
}

/** Fetch the tenant's effective governance settings + overrides. `null` on failure. */
export async function getTenantGovernance(
  tenantId: string = TENANT_ID,
): Promise<TenantSettingsResponse | null> {
  try {
    const res = await fetch(
      `${TENANT_SERVICE_URL}/tenants/${encodeURIComponent(tenantId)}/settings`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as TenantSettingsResponse;
  } catch {
    return null;
  }
}
