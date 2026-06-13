import { TENANT_ID } from "./auth";

/**
 * Per-tenant branding for the learner web surface.
 *
 * In production the tenant service resolves branding from the request host /
 * subdomain at the edge. Until that service is wired up, branding is resolved
 * here from a small static map keyed by tenant id, with a clean default so a
 * tenant that has not configured a brand still renders correctly.
 */
export interface Branding {
  /** Display name shown across the surface. */
  name: string;
  /** Short tagline under the brand name on the sign-in screen. */
  tagline: string;
  /** Primary accent colour (buttons, highlights). */
  accent: string;
}

const DEFAULT_BRANDING: Branding = {
  name: "LMS Learner",
  tagline: "Sign in to your learning experience.",
  accent: "#2952cc",
};

const BRANDING_BY_TENANT: Record<string, Branding> = {
  // Demo tenant seeded by the identity dev store.
  "11111111-1111-1111-1111-111111111111": {
    name: "Northwind Academy",
    tagline: "Welcome back to Northwind Academy.",
    accent: "#0f7b6c",
  },
};

/** Resolve branding for the current tenant, falling back to defaults. */
export function getBranding(tenantId: string = TENANT_ID): Branding {
  return BRANDING_BY_TENANT[tenantId] ?? DEFAULT_BRANDING;
}
