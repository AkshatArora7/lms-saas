import { controlPlane, withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";
import type { TenantContext } from "@lms/types";

import {
  emptyBranding,
  normalizeHost,
  type BrandingPatch,
  type BrandingRecord,
  type BrandingStore,
  type BrandingTheme,
} from "./branding.js";

interface BrandingRow {
  tenant_id: string;
  display_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  theme: BrandingTheme;
  custom_domain: string | null;
  custom_css: string | null;
  support_email: string | null;
  inherit_parent: boolean;
  updated_at: Date | string | null;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function toRecord(row: BrandingRow): BrandingRecord {
  return {
    tenantId: row.tenant_id,
    displayName: row.display_name,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    accentColor: row.accent_color,
    theme: row.theme,
    customDomain: row.custom_domain,
    customCss: row.custom_css,
    supportEmail: row.support_email,
    inheritParent: row.inherit_parent,
    updatedAt:
      row.updated_at == null
        ? null
        : row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
  };
}

const COLS = `tenant_id, display_name, logo_url, favicon_url, primary_color,
  secondary_color, accent_color, theme, custom_domain, custom_css,
  support_email, inherit_parent, updated_at`;

/**
 * Postgres-backed branding store. Own-row read/write run through `withTenant`
 * (RLS — a tenant can only touch its own row). Effective branding is resolved
 * control-plane via tenant_effective_branding(), which must read ancestor rows.
 */
export function createPrismaBrandingStore(): BrandingStore {
  return {
    async putBranding(
      ctx: TenantContext,
      patch: BrandingPatch,
    ): Promise<BrandingRecord> {
      return withTenant(ctx, async (db: Db) => {
        // Upsert: COALESCE keeps existing values for fields not in the patch.
        const rows = await db.$queryRawUnsafe<BrandingRow[]>(
          `INSERT INTO tenant_branding
             (tenant_id, display_name, logo_url, favicon_url, primary_color,
              secondary_color, accent_color, theme, custom_domain, custom_css,
              support_email, inherit_parent)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, COALESCE($8,'system'),
                   $9, $10, $11, COALESCE($12, true))
           ON CONFLICT (tenant_id) DO UPDATE SET
             display_name    = COALESCE($2, tenant_branding.display_name),
             logo_url        = COALESCE($3, tenant_branding.logo_url),
             favicon_url     = COALESCE($4, tenant_branding.favicon_url),
             primary_color   = COALESCE($5, tenant_branding.primary_color),
             secondary_color = COALESCE($6, tenant_branding.secondary_color),
             accent_color    = COALESCE($7, tenant_branding.accent_color),
             theme           = COALESCE($8, tenant_branding.theme),
             custom_domain   = COALESCE($9, tenant_branding.custom_domain),
             custom_css      = COALESCE($10, tenant_branding.custom_css),
             support_email   = COALESCE($11, tenant_branding.support_email),
             inherit_parent  = COALESCE($12, tenant_branding.inherit_parent)
           RETURNING ${COLS}`,
          ctx.tenantId,
          patch.displayName ?? null,
          patch.logoUrl ?? null,
          patch.faviconUrl ?? null,
          patch.primaryColor ?? null,
          patch.secondaryColor ?? null,
          patch.accentColor ?? null,
          patch.theme ?? null,
          patch.customDomain ?? null,
          patch.customCss ?? null,
          patch.supportEmail ?? null,
          patch.inheritParent ?? null,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, payload)
           VALUES ($1::uuid, $2, $3::jsonb)`,
          ctx.tenantId,
          EVENT_TYPES.TENANT_BRANDING_UPDATED,
          JSON.stringify({ tenantId: ctx.tenantId }),
        );
        return toRecord(rows[0]!);
      });
    },

    async getOwnBranding(ctx: TenantContext): Promise<BrandingRecord | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<BrandingRow[]>(
          `SELECT ${COLS} FROM tenant_branding WHERE tenant_id = $1::uuid LIMIT 1`,
          ctx.tenantId,
        );
        return rows[0] ? toRecord(rows[0]) : null;
      });
    },

    async getEffectiveBranding(tenantId: string): Promise<BrandingRecord> {
      // Resolve inheritance control-plane: the SQL function walks the parent
      // chain, which RLS would otherwise hide. Branding is public-facing.
      const cp = controlPlane() as unknown as Db;
      const rows = await cp.$queryRawUnsafe<BrandingRow[]>(
        `SELECT ${COLS} FROM tenant_effective_branding($1::uuid)`,
        tenantId,
      );
      return rows[0] ? toRecord(rows[0]) : emptyBranding(tenantId);
    },

    async resolveTenantByDomain(host: string): Promise<string | null> {
      // Pre-auth control-plane lookup: no tenant context exists yet, so an
      // RLS-scoped read would see nothing. custom_domain is globally UNIQUE
      // (citext), so this returns at most one tenant id and nothing else.
      const normalized = normalizeHost(host);
      if (!normalized) return null;
      const cp = controlPlane() as unknown as Db;
      const rows = await cp.$queryRawUnsafe<{ tenant_id: string }[]>(
        `SELECT tenant_id FROM tenant_branding
           WHERE custom_domain = $1::citext LIMIT 1`,
        normalized,
      );
      return rows[0]?.tenant_id ?? null;
    },
  };
}
