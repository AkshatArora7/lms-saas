import type { TenantContext } from "@lms/types";

import type { AuthzStore, Grant, OrgUnitAncestry } from "./authz.js";

/**
 * In-memory authz store. Grants and the org-unit hierarchy are seeded (mirroring
 * role_assignment -> role_permission and org_unit.path), tenant-filtered to
 * emulate RLS, so the pure decision logic is exercised exactly as in prod.
 */
export class MemoryAuthzStore implements AuthzStore {
  private grants = new Map<string, Grant[]>(); // key: `${tenantId}:${userId}`
  private ancestry = new Map<string, OrgUnitAncestry>(); // key: `${tenantId}:${ouId}`

  private gk(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  /** Seed a grant for a user in a tenant. */
  seedGrant(tenantId: string, userId: string, grant: Grant): void {
    const key = this.gk(tenantId, userId);
    const list = this.grants.get(key) ?? [];
    list.push(grant);
    this.grants.set(key, list);
  }

  /** Seed an org unit's ancestor path (root-first, excluding self). */
  seedOrgUnit(tenantId: string, id: string, path: string[]): void {
    this.ancestry.set(`${tenantId}:${id}`, { id, path });
  }

  async listGrants(ctx: TenantContext, userId: string): Promise<Grant[]> {
    return [...(this.grants.get(this.gk(ctx.tenantId, userId)) ?? [])];
  }

  async getAncestry(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<OrgUnitAncestry | null> {
    return this.ancestry.get(`${ctx.tenantId}:${orgUnitId}`) ?? null;
  }
}
