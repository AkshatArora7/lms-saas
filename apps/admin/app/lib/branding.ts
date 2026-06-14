import { TENANT_ID } from "./auth";
import type { Brand } from "@lms/ui";
import { defaultBrand } from "@lms/ui";

/**
 * Per-tenant branding for the admin console.
 *
 * In production the tenant service resolves branding from the request host /
 * subdomain at the edge. Until that service is wired up, branding is resolved
 * here from a small static map keyed by tenant id, with a clean default so a
 * tenant that has not configured a brand still renders correctly.
 */
const DEFAULT_BRAND: Brand = {
  ...defaultBrand,
  name: "LMS Admin",
  tagline: "Tenant administration console.",
  accent: "#6a8cff",
};

const BRANDING_BY_TENANT: Record<string, Brand> = {
  // Demo tenant seeded by the identity dev store.
  "11111111-1111-1111-1111-111111111111": {
    ...defaultBrand,
    name: "Northwind Academy",
    tagline: "Administration console.",
    accent: "#34d399",
  },
};

/** Resolve branding for the current tenant, falling back to defaults. */
export function getBrand(tenantId: string = TENANT_ID): Brand {
  return BRANDING_BY_TENANT[tenantId] ?? DEFAULT_BRAND;
}

/** Backwards-compatible alias for existing app callers. */
export function getBranding(tenantId: string = TENANT_ID): Brand {
  return getBrand(tenantId);
}
