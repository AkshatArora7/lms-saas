import { withTenant } from "@lms/db";

import { computeRowHash, verifyChain, type VerifyResult } from "./chain.js";
import type {
  AuditEntry,
  AuditFilter,
  AuditStore,
  NewAuditInput,
} from "./store.js";

interface AuditRow {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  ip_address: string | null;
  created_at: Date | string;
  prev_hash: string | null;
  row_hash: string | null;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: asMetadata(row.metadata),
    ipAddress: row.ip_address,
    createdAt: iso(row.created_at),
    prevHash: row.prev_hash,
    rowHash: row.row_hash ?? "",
  };
}

// bytea hashes are read/written as hex via encode()/decode() so there is no
// driver-specific Buffer marshalling. `decode(NULL,'hex')` is NULL, so the
// chain head naturally stores a NULL prev_hash.
const SELECT_COLUMNS = `
  id, tenant_id, actor_id, action, target_type, target_id, metadata,
  host(ip_address) AS ip_address, created_at,
  encode(prev_hash, 'hex') AS prev_hash, encode(row_hash, 'hex') AS row_hash`;

/**
 * Postgres-backed, hash-chained audit store. Every call runs through
 * `withTenant`, so the chain is per-tenant under RLS — one tenant can neither
 * read nor extend another's. Append links each row to the tenant's current
 * chain head; uuid params are cast `::uuid`.
 */
export function createPrismaStore(): AuditStore {
  return {
    async append(ctx, input: NewAuditInput): Promise<AuditEntry> {
      return withTenant(ctx, async (db: Db) => {
        // Current chain head for this tenant (RLS-scoped).
        const head = await db.$queryRawUnsafe<{ row_hash: string | null }[]>(
          `SELECT encode(row_hash, 'hex') AS row_hash
             FROM audit_log
            WHERE row_hash IS NOT NULL
            ORDER BY created_at DESC, id DESC
            LIMIT 1`,
        );
        const prevHash = head[0]?.row_hash ?? null;

        // Insert the row first (DB assigns id + created_at) with prev_hash set.
        const inserted = await db.$queryRawUnsafe<AuditRow[]>(
          `INSERT INTO audit_log
             (tenant_id, actor_id, action, target_type, target_id, metadata,
              ip_address, prev_hash)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::inet,
                   decode($8, 'hex'))
           RETURNING ${SELECT_COLUMNS}`,
          ctx.tenantId,
          input.actorId ?? null,
          input.action,
          input.targetType ?? null,
          input.targetId ?? null,
          JSON.stringify(input.metadata ?? {}),
          input.ipAddress ?? null,
          prevHash,
        );
        const entry = toEntry(inserted[0]!);

        // Compute the row hash over the stored payload and persist it.
        const rowHash = computeRowHash(prevHash, entry);
        await db.$executeRawUnsafe(
          `UPDATE audit_log SET row_hash = decode($1, 'hex') WHERE id = $2::uuid`,
          rowHash,
          entry.id,
        );
        return { ...entry, rowHash };
      });
    },

    async list(ctx, filter: AuditFilter = {}): Promise<AuditEntry[]> {
      return withTenant(ctx, async (db: Db) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filter.actorId) {
          params.push(filter.actorId);
          conditions.push(`actor_id = $${params.length}::uuid`);
        }
        if (filter.targetType) {
          params.push(filter.targetType);
          conditions.push(`target_type = $${params.length}`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
        const rows = await db.$queryRawUnsafe<AuditRow[]>(
          `SELECT ${SELECT_COLUMNS} FROM audit_log ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit}`,
          ...params,
        );
        return rows.map(toEntry);
      });
    },

    async verify(ctx): Promise<VerifyResult> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<AuditRow[]>(
          `SELECT ${SELECT_COLUMNS} FROM audit_log
            ORDER BY created_at ASC, id ASC`,
        );
        return verifyChain(rows.map(toEntry));
      });
    },
  };
}
