import { cache } from "react";

import type { Brand } from "@lms/ui";
import { defaultBrand } from "@lms/ui";

import { TENANT_ID } from "./auth";
import { getTenantBranding, type EffectiveBranding } from "./tenant-api";

/**
 * Per-tenant branding for the learner web surface.
 *
 * Branding now resolves from the tenant service's EFFECTIVE (inheritance-
 * resolved) record — sub-tenant override → parent (district) → platform default
 * — via `getTenantBranding` (#12). The effective record is loaded ONCE per
 * request at the layout boundary (`loadBranding`, awaited in app/layout.tsx)
 * and memoized with React `cache()`; the existing synchronous `getBrand`/
 * `getBranding` accessors then read the resolved brand out of that per-request
 * cache, so the ~29 page call-sites stay untouched (still synchronous). When the
 * tenant service is unreachable or has no row, callers transparently get the
 * clean DEFAULT_BRAND and the app renders offline-safe.
 */
const DEFAULT_BRAND: Brand = {
  ...defaultBrand,
  name: "LMS Learner",
  tagline: "Sign in to your learning experience.",
  accent: "#2952cc",
};

/** A valid `#rrggbb` accent, or null so we can fall back deterministically. */
function asHex(value: string | null): string | null {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

/**
 * Map the tenant service's effective `BrandingRecord` onto the `@lms/ui` Brand:
 * accent ← accentColor || primaryColor (else the default accent), name ←
 * displayName, logoUrl ← logoUrl. The remaining Brand fields (tagline,
 * fontFamily, radius) have no effective-branding counterpart, so the default
 * tagline is kept and font/radius are left unset (theme defaults apply).
 */
export function brandFromEffective(record: EffectiveBranding): Brand {
  const accent =
    asHex(record.accentColor) ?? asHex(record.primaryColor) ?? DEFAULT_BRAND.accent;
  return {
    name: record.displayName?.trim() || DEFAULT_BRAND.name,
    tagline: DEFAULT_BRAND.tagline,
    accent,
    logoUrl: record.logoUrl ?? null,
  };
}

/**
 * Per-request brand holder. `cache()` gives ONE instance per server request
 * (React de-dupes by call within a request), so `loadBranding` (layout) and
 * `getBrand` (pages) share the same resolved value within a single render.
 */
const brandHolder = cache((): { brand: Brand } => ({ brand: DEFAULT_BRAND }));

/**
 * Resolve the effective branding for `tenantId` from the tenant service and
 * stash the mapped Brand in the per-request holder. Awaited once in the root
 * layout BEFORE page components render. Offline-safe: on null/failure the
 * holder keeps the clean default. Returns the raw effective record (or null) so
 * the layout can apply the two fields outside the Brand token set — faviconUrl
 * and customCss.
 */
export async function loadBranding(
  tenantId: string = TENANT_ID,
): Promise<EffectiveBranding | null> {
  const effective = await getTenantBranding(tenantId);
  brandHolder().brand = effective ? brandFromEffective(effective) : DEFAULT_BRAND;
  return effective;
}

/**
 * Resolve branding for the current tenant. Synchronous: returns the brand
 * resolved by `loadBranding` for this request (or the clean default before
 * load / on failure). The `tenantId` argument is retained for call-site
 * compatibility; resolution is request-scoped via `loadBranding`.
 */
export function getBrand(_tenantId: string = TENANT_ID): Brand {
  return brandHolder().brand;
}

/** Backwards-compatible alias for existing app callers. */
export function getBranding(tenantId: string = TENANT_ID): Brand {
  return getBrand(tenantId);
}
