import { randomUUID } from "node:crypto";

import {
  isDescendantOf,
  type CreateDelegationResult,
  type DelegationRecord,
  type DelegationStore,
  type NewDelegationInput,
  type TenantNode,
} from "./delegation.js";

/**
 * In-memory delegation store + hierarchy. The hierarchy is seeded (mirroring the
 * control-plane `tenant.parent_id` tree) so descendant checks and delegation
 * validation behave exactly as the Prisma store's `tenant_subtree()` queries.
 */
export class MemoryDelegationStore implements DelegationStore {
  private rows: DelegationRecord[] = [];
  private nodes: TenantNode[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {}

  /** Seed a tenant and its parent into the hierarchy. */
  seedTenant(id: string, parentId: string | null): void {
    this.nodes.push({ id, parentId });
  }

  async createDelegation(
    input: NewDelegationInput,
  ): Promise<CreateDelegationResult> {
    const known = new Set(this.nodes.map((n) => n.id));
    if (!known.has(input.delegatorTenantId) || !known.has(input.scopeTenantId)) {
      return { ok: false, reason: "unknown_tenant" };
    }
    // A delegator may only delegate admin of its own descendants.
    if (
      !isDescendantOf(input.scopeTenantId, input.delegatorTenantId, this.nodes)
    ) {
      return { ok: false, reason: "scope_not_descendant" };
    }
    const role = input.role ?? "school_admin";
    const existing = this.rows.find(
      (r) =>
        r.scopeTenantId === input.scopeTenantId &&
        r.delegateUserId === input.delegateUserId &&
        r.role === role &&
        r.revokedAt === null,
    );
    if (existing) return { ok: true, delegation: existing };
    const delegation: DelegationRecord = {
      id: this.generateId(),
      delegatorTenantId: input.delegatorTenantId,
      scopeTenantId: input.scopeTenantId,
      delegateUserId: input.delegateUserId,
      role,
      createdAt: new Date(0).toISOString(),
      revokedAt: null,
    };
    this.rows.push(delegation);
    return { ok: true, delegation };
  }

  async listDelegations(scopeTenantId: string): Promise<DelegationRecord[]> {
    return this.rows.filter(
      (r) => r.scopeTenantId === scopeTenantId && r.revokedAt === null,
    );
  }

  async revokeDelegation(id: string): Promise<DelegationRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.revokedAt = new Date(1).toISOString();
    return row;
  }

  async isDescendant(
    targetTenantId: string,
    ancestorTenantId: string,
  ): Promise<boolean> {
    return isDescendantOf(targetTenantId, ancestorTenantId, this.nodes);
  }

  async hasActiveDelegation(
    scopeTenantId: string,
    userId: string,
  ): Promise<boolean> {
    return this.rows.some(
      (r) =>
        r.scopeTenantId === scopeTenantId &&
        r.delegateUserId === userId &&
        r.revokedAt === null,
    );
  }
}
