import type { TenantContext } from "@lms/types";

import {
  emptyBranding,
  mergeBranding,
  type BrandingPatch,
  type BrandingRecord,
  type BrandingStore,
} from "./branding.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory branding store. Own-row access is tenant-filtered to emulate RLS;
 * effective branding walks a seeded parent chain (the control-plane hierarchy).
 */
export class MemoryBrandingStore implements BrandingStore {
  private readonly rows = new Map<string, BrandingRecord>();
  private readonly parentOf = new Map<string, string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Seed the tenant hierarchy used for inheritance resolution. */
  seedParent(childId: string, parentId: string): void {
    this.parentOf.set(childId, parentId);
  }

  async putBranding(
    ctx: TenantContext,
    patch: BrandingPatch,
  ): Promise<BrandingRecord> {
    const existing = this.rows.get(ctx.tenantId) ?? emptyBranding(ctx.tenantId);
    const merged: BrandingRecord = {
      ...existing,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ),
      tenantId: ctx.tenantId,
      updatedAt: this.now().toISOString(),
    };
    this.rows.set(ctx.tenantId, merged);
    return merged;
  }

  async getOwnBranding(ctx: TenantContext): Promise<BrandingRecord | null> {
    return this.rows.get(ctx.tenantId) ?? null;
  }

  async getEffectiveBranding(tenantId: string): Promise<BrandingRecord> {
    let acc = this.rows.get(tenantId) ?? emptyBranding(tenantId);
    let cur: string | undefined = tenantId;
    let guard = 0;
    while (acc.inheritParent && guard < 32) {
      guard += 1;
      cur = this.parentOf.get(cur);
      if (!cur) break;
      const parent = this.rows.get(cur);
      if (parent) acc = mergeBranding(acc, parent);
    }
    return acc;
  }
}
