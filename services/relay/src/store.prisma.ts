import { controlPlane, withTenant } from "@lms/db";
import type { EventEnvelope } from "@lms/events";
import type { TenantContext, TenantTier } from "@lms/types";

import {
  envelopeFromRow,
  type ConsumerInbox,
  type DrainResult,
  type OutboxRelayStore,
  type OutboxRow,
} from "./store.js";

interface OutboxDbRow {
  id: string;
  tenant_id: string;
  type: string;
  actor_id: string | null;
  org_unit_id: string | null;
  payload: unknown;
  occurred_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function toRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    actorId: row.actor_id,
    orgUnitId: row.org_unit_id,
    payload: asPayload(row.payload),
    occurredAt: iso(row.occurred_at),
    version: 1,
  };
}

export interface PrismaRelayStoreOptions {
  /** Tier used when re-entering each tenant's RLS context (pool by default). */
  tier?: TenantTier;
  /** Shared pool DB url for pool tenants (defaults to DATABASE_URL). */
  databaseUrl?: string;
}

/**
 * Postgres-backed `OutboxRelayStore`.
 *
 * WHY two access modes (the heart of the tenant-safe design):
 *   `event_outbox` is under FORCE ROW LEVEL SECURITY and the app connects as a
 *   NOBYPASSRLS role. A naive `SELECT * FROM event_outbox WHERE published_at IS
 *   NULL` with no tenant GUC returns ZERO rows (current_tenant_id() is NULL), so
 *   the relay can never see the outbox cross-tenant. Instead it enumerates the
 *   tenants from the CONTROL-PLANE `tenant` registry (not under RLS, read via
 *   `controlPlane()`), then drains each tenant INSIDE its own RLS-scoped
 *   transaction. Isolation is preserved end-to-end: every outbox read/write
 *   happens only under the matching `app.tenant_id` GUC.
 */
export function createPrismaStore(
  options: PrismaRelayStoreOptions = {},
): OutboxRelayStore {
  const tier: TenantTier = options.tier ?? "pool";
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const cp = controlPlane();

  function contextFor(tenantId: string): TenantContext {
    return { tenantId, tier, databaseUrl };
  }

  return {
    async listTenantIds(): Promise<string[]> {
      // Control-plane registry — NOT tenant-scoped, never via withTenant. Active
      // tenants only; suspended/deleted tenants are not drained.
      const rows = await cp.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM tenant WHERE status = 'active' ORDER BY created_at`,
      );
      return rows.map((r) => r.id);
    },

    async drainTenant(
      tenantId: string,
      deliver: (event: EventEnvelope) => Promise<void>,
    ): Promise<DrainResult> {
      return withTenant(contextFor(tenantId), async (db) => {
        // Oldest-first so events publish in causal order within a tenant. The
        // partial index ix_outbox_unpublished (WHERE published_at IS NULL)
        // backs this scan.
        const rows = await db.$queryRawUnsafe<OutboxDbRow[]>(
          `SELECT id, tenant_id, type, actor_id, org_unit_id, payload, occurred_at
             FROM event_outbox
            WHERE published_at IS NULL
            ORDER BY occurred_at ASC`,
        );

        const deliveredIds: string[] = [];
        for (const dbRow of rows) {
          const envelope = envelopeFromRow(toRow(dbRow));
          // Await delivery per row; a throw aborts the loop and leaves the
          // remaining (and current) rows unpublished for the next pass.
          await deliver(envelope);
          deliveredIds.push(dbRow.id);
        }

        if (deliveredIds.length > 0) {
          // Stamp only rows that delivered, and re-guard published_at IS NULL so
          // a concurrent relay can't double-stamp. Parameterized id array.
          await db.$executeRawUnsafe(
            `UPDATE event_outbox
                SET published_at = now()
              WHERE id = ANY($1::uuid[]) AND published_at IS NULL`,
            deliveredIds,
          );
        }

        return { published: deliveredIds.length };
      });
    },
  };
}

/**
 * Postgres-backed `ConsumerInbox` over `event_inbox`. Runs inside the tenant
 * GUC (RLS-scoped) and relies on the PK (consumer, message_id) + ON CONFLICT DO
 * NOTHING for atomic, idempotent claim. rowCount === 1 means first delivery.
 */
export function createPrismaConsumerInbox(
  options: PrismaRelayStoreOptions = {},
): ConsumerInbox {
  const tier: TenantTier = options.tier ?? "pool";
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? "";

  return {
    async markProcessed(consumer, messageId, tenantId): Promise<boolean> {
      const ctx: TenantContext = { tenantId, tier, databaseUrl };
      return withTenant(ctx, async (db) => {
        const affected = await db.$executeRawUnsafe(
          `INSERT INTO event_inbox (consumer, message_id, tenant_id)
           VALUES ($1, $2::uuid, $3::uuid)
           ON CONFLICT (consumer, message_id) DO NOTHING`,
          consumer,
          messageId,
          tenantId,
        );
        return affected === 1;
      });
    },
  };
}
