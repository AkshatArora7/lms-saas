import { TENANT_ID } from "./auth";
import type { Brand } from "@lms/ui";
import { defaultBrand, brandRegistry } from "@lms/ui";

/**
 * Per-tenant branding for the learner web surface.
 *
 * In production the tenant service resolves branding from the request host /
 * subdomain at the edge. Until that service is wired up, branding is resolved
 * here from the shared @lms/ui brand registry, with a clean default so a tenant
 * that has not configured a brand still renders correctly. The registry carries
 * the full white-label token set (accent, typography, corner radius, logo).
 */
const DEFAULT_BRAND: Brand = {
  ...defaultBrand,
  name: "LMS Learner",
  tagline: "Sign in to your learning experience.",
  accent: "#2952cc",
};

/** Resolve branding for the current tenant, falling back to defaults. */
export function getBrand(tenantId: string = TENANT_ID): Brand {
  return brandRegistry[tenantId] ?? DEFAULT_BRAND;
}

/** Backwards-compatible alias for existing app callers. */
export function getBranding(tenantId: string = TENANT_ID): Brand {
  return getBrand(tenantId);
}
