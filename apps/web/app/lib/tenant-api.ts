import { TENANT_ID } from "./auth";

/**
 * Server-only client for the tenant (control-plane) microservice.
 *
 * BFF read boundary for white-label theming on the LEARNER surface. Ported from
 * the admin client (apps/admin/app/lib/tenant-api.ts): the tenant registry is a
 * control plane (no `x-tenant-id` resolver) addressed by id in the path; we
 * still forward `x-tenant-id` for parity with the other clients. Reads return
 * `null` on failure so the app renders offline-safe with the clean default
 * brand and never crashes when the tenant service is unreachable.
 */

export const TENANT_SERVICE_URL =
  process.env.TENANT_SERVICE_URL ?? "http://localhost:4002";

export type BrandingTheme = "light" | "dark" | "system";

/** Effective (inheritance-resolved) white-label branding for a tenant. */
export interface EffectiveBranding {
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

interface BrandingResponse {
  /** Effective branding (own row with NULLs filled from ancestors). */
  branding: EffectiveBranding;
  /** The tenant's OWN overrides (no inheritance), or null when unset. */
  overrides: EffectiveBranding | null;
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/**
 * Fetch the tenant's effective (inheritance-resolved) branding. Returns `null`
 * when the service is unreachable or returns a non-OK status, so callers fall
 * back to the clean default brand and the app renders offline-safe.
 */
export async function getTenantBranding(
  tenantId: string = TENANT_ID,
): Promise<EffectiveBranding | null> {
  try {
    const res = await fetch(
      `${TENANT_SERVICE_URL}/tenants/${encodeURIComponent(tenantId)}/branding`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as BrandingResponse;
    return data.branding ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve an incoming request Host to a tenant id via the pre-auth,
 * control-plane `GET /tenants/by-domain/:host` endpoint (matches
 * `tenant_branding.custom_domain`, citext UNIQUE). Returns `null` on 404 (no
 * custom domain configured) or any failure, so the caller falls back to the
 * default/session tenant. Returns ONLY the opaque tenant id — no tenant-owned
 * data is exposed by this lookup.
 */
export async function resolveTenantByDomain(
  host: string,
): Promise<string | null> {
  const trimmed = host.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(
      `${TENANT_SERVICE_URL}/tenants/by-domain/${encodeURIComponent(trimmed)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tenantId?: string };
    return data.tenantId ?? null;
  } catch {
    return null;
  }
}
