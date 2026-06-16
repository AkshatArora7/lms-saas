import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import { computeRowHash, verifyChain, type VerifyResult } from "./chain.js";
import type {
  AuditEntry,
  AuditFilter,
  AuditStore,
  NewAuditInput,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory AuditStore. Entries are kept per tenant in insertion order to
 * emulate the per-tenant hash chain Postgres holds in production. Used by the
 * test suite and `AUDIT_STORE=memory`.
 */
export class MemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private tenantChain(tenantId: string): AuditEntry[] {
    return this.entries.filter((e) => e.tenantId === tenantId);
  }

  async append(
    ctx: TenantContext,
    input: NewAuditInput,
  ): Promise<AuditEntry> {
    const chain = this.tenantChain(ctx.tenantId);
    const prevHash = chain.length > 0 ? chain[chain.length - 1]!.rowHash : null;
    const base = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
      createdAt: this.now().toISOString(),
    };
    const entry: AuditEntry = {
      ...base,
      prevHash,
      rowHash: computeRowHash(prevHash, base),
    };
    this.entries.push(entry);
    return entry;
  }

  async list(
    ctx: TenantContext,
    filter: AuditFilter = {},
  ): Promise<AuditEntry[]> {
    const rows = this.tenantChain(ctx.tenantId)
      .filter(
        (e) =>
          (filter.actorId === undefined || e.actorId === filter.actorId) &&
          (filter.targetType === undefined ||
            e.targetType === filter.targetType),
      )
      .slice()
      .reverse();
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async verify(ctx: TenantContext): Promise<VerifyResult> {
    return verifyChain(this.tenantChain(ctx.tenantId));
  }

  /**
   * TEST-ONLY: mutate a stored entry's fields WITHOUT recomputing its hash, to
   * simulate tampering. Production has no such path (the table is append-only).
   */
  tamperForTest(id: string, patch: Partial<AuditEntry>): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) Object.assign(entry, patch);
  }
}
