import type { TenantContext } from "@lms/types";

export type BrandingTheme = "light" | "dark" | "system";
export const BRANDING_THEMES: readonly BrandingTheme[] = [
  "light",
  "dark",
  "system",
];

/** Inheritable fields (filled from ancestors when unset). */
export interface BrandingFields {
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
}

export interface BrandingRecord extends BrandingFields {
  tenantId: string;
  updatedAt: string | null;
}

export type BrandingPatch = Partial<Omit<BrandingFields, "theme">> & {
  theme?: BrandingTheme;
};

/** A branding record with all inheritable fields null (the empty default). */
export function emptyBranding(tenantId: string): BrandingRecord {
  return {
    tenantId,
    displayName: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    theme: "system",
    customDomain: null,
    customCss: null,
    supportEmail: null,
    inheritParent: true,
    updatedAt: null,
  };
}

/**
 * Fill a child's null inheritable fields from a parent. Mirrors
 * tenant_effective_branding(): theme/custom_domain/custom_css are NOT inherited
 * (they are tenant-specific), matching the SQL function's COALESCE set.
 */
export function mergeBranding(
  child: BrandingRecord,
  parent: BrandingRecord,
): BrandingRecord {
  return {
    ...child,
    displayName: child.displayName ?? parent.displayName,
    logoUrl: child.logoUrl ?? parent.logoUrl,
    faviconUrl: child.faviconUrl ?? parent.faviconUrl,
    primaryColor: child.primaryColor ?? parent.primaryColor,
    secondaryColor: child.secondaryColor ?? parent.secondaryColor,
    accentColor: child.accentColor ?? parent.accentColor,
    supportEmail: child.supportEmail ?? parent.supportEmail,
  };
}

/**
 * Tenant-scoped branding persistence. Read/write of a tenant's OWN row is
 * RLS-scoped (via withTenant). Effective (inheritance-resolved) branding reads
 * ancestor rows and is resolved control-plane, since branding is public-facing
 * white-label shown before authentication.
 */
export interface BrandingStore {
  /** Upsert the tenant's own branding row (emits tenant.branding.updated). */
  putBranding(
    ctx: TenantContext,
    patch: BrandingPatch,
  ): Promise<BrandingRecord>;

  /** The tenant's own row (no inheritance), or null when unset. */
  getOwnBranding(ctx: TenantContext): Promise<BrandingRecord | null>;

  /** Effective branding: own row with NULLs filled from ancestors. */
  getEffectiveBranding(tenantId: string): Promise<BrandingRecord>;

  /**
   * Resolve a custom domain (the incoming request Host) to its owning tenant id,
   * or null when no tenant claims it. PRE-AUTH and control-plane: it runs before
   * any tenant context/JWT exists, so it is NOT RLS-scoped. Safe because
   * `custom_domain` is GLOBALLY UNIQUE — a host maps to at most one tenant — and
   * only the opaque tenant id is returned (no tenant-owned data). The caller
   * then re-resolves effective branding via getEffectiveBranding(tenantId).
   */
  resolveTenantByDomain(host: string): Promise<string | null>;
}

/**
 * Normalize an incoming Host header for an exact custom-domain lookup: trim
 * surrounding whitespace, lowercase (citext is case-insensitive but the memory
 * store mirrors via lowercase), and defensively strip a trailing dot and any
 * `:port` suffix. Returns null when the result is empty (invalid host).
 */
export function normalizeHost(host: string): string | null {
  let h = host.trim().toLowerCase();
  // Strip a :port suffix (but leave IPv6-bracketed hosts alone — not expected
  // for custom domains). e.g. "school.edu:443" -> "school.edu".
  const colon = h.indexOf(":");
  if (colon !== -1 && h.indexOf("]") === -1) h = h.slice(0, colon);
  // Strip a trailing FQDN dot. e.g. "school.edu." -> "school.edu".
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h.length > 0 ? h : null;
}
