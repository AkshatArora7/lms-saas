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
}
