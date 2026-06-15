import { TENANT_ID } from "./auth";
import type { Brand } from "@lms/ui";
import { defaultBrand, brandRegistry } from "@lms/ui";

/**
 * Per-tenant branding for the admin console.
 *
 * In production the tenant service resolves branding from the request host /
 * subdomain at the edge. Until that service is wired up, branding is resolved
 * here from the shared @lms/ui brand registry, with a clean admin default so a
 * tenant that has not configured a brand still renders correctly. Configured
 * tenants inherit the full white-label token set (accent, typography, corner
 * radius, logo) with an administration-flavoured tagline.
 */
const DEFAULT_BRAND: Brand = {
  ...defaultBrand,
  name: "LMS Admin",
  tagline: "Tenant administration console.",
  accent: "#6a8cff",
};

/** Resolve branding for the current tenant, falling back to defaults. */
export function getBrand(tenantId: string = TENANT_ID): Brand {
  const tenantBrand = brandRegistry[tenantId];
  if (!tenantBrand) {
    return DEFAULT_BRAND;
  }
  return { ...tenantBrand, tagline: "Administration console." };
}

/** Backwards-compatible alias for existing app callers. */
export function getBranding(tenantId: string = TENANT_ID): Brand {
  return getBrand(tenantId);
}
