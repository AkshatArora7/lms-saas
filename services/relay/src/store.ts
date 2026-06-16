import type { EventEnvelope, EventTransport } from "@lms/events";

/**
 * A raw `event_outbox` row, tenant-scoped. The relay reads these inside a
 * per-tenant RLS transaction and maps them to canonical `EventEnvelope`s.
 */
export interface OutboxRow {
  id: string;
  tenantId: string;
  type: string;
  actorId: string | null;
  orgUnitId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  version?: number;
}

/** Outcome of draining a single tenant's outbox in one pass. */
export interface DrainResult {
  published: number;
}

/** Aggregate outcome of one full relay pass over all tenants. */
export interface RelaySummary {
  tenants: number;
  published: number;
}

/**
 * Persistence boundary for the outbox relay. Two distinct access modes:
 *
 *  - `listTenantIds()` reads the CONTROL-PLANE `tenant` registry, which is NOT
 *    under RLS. The relay must enumerate tenants here because the tenant-scoped
 *    `event_outbox` runs under FORCE ROW LEVEL SECURITY with a NOBYPASSRLS app
 *    role: a single cross-tenant `SELECT * FROM event_outbox` would return zero
 *    rows (current_tenant_id() is NULL outside a tenant GUC). So we learn the
 *    set of tenants from the control plane, then re-enter each tenant's RLS
 *    context one at a time.
 *
 *  - `drainTenant(tenantId, deliver)` runs inside ONE RLS-scoped transaction for
 *    that tenant (set_config('app.tenant_id', tenantId, true)), selects the
 *    unpublished rows oldest-first, awaits `deliver(envelope)` for each, and
 *    stamps `published_at = now()` only for rows that delivered successfully.
 *    This is the transactional-outbox drain: at-least-once delivery, with
 *    consumer-side dedupe (see `ConsumerInbox`) giving effective exactly-once.
 */
export interface OutboxRelayStore {
  /** Distinct tenant ids from the control-plane registry (no tenant GUC). */
  listTenantIds(): Promise<string[]>;

  /**
   * Drain one tenant's unpublished outbox rows. `deliver` is awaited per row;
   * if it throws, that row is left unpublished (retried on the next pass).
   */
  drainTenant(
    tenantId: string,
    deliver: (event: EventEnvelope) => Promise<void>,
  ): Promise<DrainResult>;
}

/**
 * Consumer-side exactly-once dedupe over `event_inbox`. A consumer records that
 * it has processed `(consumer, messageId)`; the first record wins. Redelivery
 * of the same event id for the same consumer is a no-op. Scoped to the tenant
 * GUC because `event_inbox` is under RLS.
 */
export interface ConsumerInbox {
  /**
   * Atomically claim `(consumer, messageId)` for `tenantId`. Returns true when
   * THIS call inserted the row (first delivery) and false when it already
   * existed (a redelivery to skip). Implemented as
   * `INSERT ... ON CONFLICT DO NOTHING` and rowCount === 1.
   */
  markProcessed(
    consumer: string,
    messageId: string,
    tenantId: string,
  ): Promise<boolean>;
}

/** Build a canonical `EventEnvelope` from a raw outbox row (pure helper). */
export function envelopeFromRow(row: OutboxRow): EventEnvelope {
  return {
    id: row.id,
    type: row.type,
    tenantId: row.tenantId,
    occurredAt: row.occurredAt,
    actorId: row.actorId,
    orgUnitId: row.orgUnitId,
    version: row.version ?? 1,
    payload: row.payload ?? {},
  };
}

/** Sort outbox rows oldest-first (occurredAt ascending). Pure helper. */
export function sortByOccurredAt<T extends { occurredAt: string }>(
  rows: T[],
): T[] {
  return rows.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/**
 * The relay orchestrator. `runOnce()` is the unit-testable core: it enumerates
 * tenants from the control plane and drains each one's outbox through the
 * injected transport, returning a summary. A polling wrapper (`runForever`)
 * simply calls `runOnce` on an interval.
 */
export class OutboxRelay {
  constructor(
    private readonly store: OutboxRelayStore,
    private readonly transport: EventTransport,
  ) {}

  /** One full pass: drain every tenant's unpublished outbox rows. */
  async runOnce(): Promise<RelaySummary> {
    const tenantIds = await this.store.listTenantIds();
    let published = 0;
    for (const tenantId of tenantIds) {
      const result = await this.store.drainTenant(tenantId, (event) =>
        this.transport.deliver(event),
      );
      published += result.published;
    }
    return { tenants: tenantIds.length, published };
  }

  /**
   * Poll `runOnce` every `intervalMs`. Returns a stop function. Errors from a
   * pass are passed to `onError` (default: rethrow-swallow + continue) so a
   * transient failure never kills the loop.
   */
  runForever(
    intervalMs: number,
    onError: (err: unknown) => void = () => {},
  ): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        await this.runOnce();
      } catch (err) {
        onError(err);
      }
      if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}
