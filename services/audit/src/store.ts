import type { TenantContext } from "@lms/types";

import type { ChainableEntry, ChainLink, VerifyResult } from "./chain.js";

/** A persisted, hash-chained audit entry. */
export type AuditEntry = ChainableEntry & ChainLink;

export interface NewAuditInput {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface AuditFilter {
  actorId?: string;
  targetType?: string;
  limit?: number;
}

/**
 * Persistence boundary for the audit service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation (with the
 * `prev_hash`/`row_hash` chain) while tests inject an in-memory one — mirroring
 * the other domain services.
 */
export interface AuditStore {
  /** Append a tamper-evident entry, linking it to the tenant's chain head. */
  append(ctx: TenantContext, input: NewAuditInput): Promise<AuditEntry>;

  /** Recent entries (most-recent first), optionally filtered. */
  list(ctx: TenantContext, filter?: AuditFilter): Promise<AuditEntry[]>;

  /** Re-hash the tenant's chain in order and report the first break, if any. */
  verify(ctx: TenantContext): Promise<VerifyResult>;
}
