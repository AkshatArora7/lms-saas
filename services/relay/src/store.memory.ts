import { randomUUID } from "node:crypto";

import type { EventEnvelope } from "@lms/events";

import {
  envelopeFromRow,
  sortByOccurredAt,
  type ConsumerInbox,
  type DrainResult,
  type OutboxRelayStore,
  type OutboxRow,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface StoredOutboxRow extends OutboxRow {
  publishedAt: string | null;
}

/**
 * In-memory `OutboxRelayStore`. Outbox rows are tagged by tenant id to emulate
 * the row-level isolation Postgres RLS enforces in production:
 * `drainTenant(tenantId, …)` only ever touches rows whose `tenantId` matches,
 * exactly as the per-tenant GUC transaction does against the real table. Used
 * by the unit tests and `RELAY_STORE=memory`.
 */
export class MemoryOutboxRelayStore implements OutboxRelayStore {
  private rows: StoredOutboxRow[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Seed an unpublished outbox row for a tenant (test/dev helper). */
  seedOutbox(row: Omit<OutboxRow, "id"> & { id?: string }): string {
    const id = row.id ?? randomUUID();
    this.rows.push({
      id,
      tenantId: row.tenantId,
      type: row.type,
      actorId: row.actorId ?? null,
      orgUnitId: row.orgUnitId ?? null,
      payload: row.payload ?? {},
      occurredAt: row.occurredAt,
      version: row.version,
      publishedAt: null,
    });
    return id;
  }

  /** Inspect a row's published timestamp (test helper). */
  publishedAt(id: string): string | null {
    return this.rows.find((r) => r.id === id)?.publishedAt ?? null;
  }

  async listTenantIds(): Promise<string[]> {
    return [...new Set(this.rows.map((r) => r.tenantId))];
  }

  async drainTenant(
    tenantId: string,
    deliver: (event: EventEnvelope) => Promise<void>,
  ): Promise<DrainResult> {
    // Tenant-scoped: only this tenant's unpublished rows, oldest-first.
    const pending = sortByOccurredAt(
      this.rows.filter((r) => r.tenantId === tenantId && r.publishedAt === null),
    );
    let published = 0;
    for (const row of pending) {
      await deliver(envelopeFromRow(row));
      // Only stamp after a successful delivery — a throw leaves it for retry.
      row.publishedAt = this.now().toISOString();
      published += 1;
    }
    return { published };
  }
}

/**
 * In-memory `ConsumerInbox` mirroring the `event_inbox` PK (consumer,
 * message_id). First `markProcessed` for a key wins; later ones are no-ops.
 */
export class MemoryConsumerInbox implements ConsumerInbox {
  private seen = new Set<string>();

  private key(consumer: string, messageId: string): string {
    return `${consumer}::${messageId}`;
  }

  async markProcessed(
    consumer: string,
    messageId: string,
    _tenantId: string,
  ): Promise<boolean> {
    const key = this.key(consumer, messageId);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

/** A memory relay store pre-seeded with one demo-tenant outbox row. */
export function createSeededMemoryStore(
  now: () => Date = () => new Date(),
): MemoryOutboxRelayStore {
  const store = new MemoryOutboxRelayStore(now);
  store.seedOutbox({
    tenantId: DEMO_TENANT_ID,
    type: "enrollment.created",
    actorId: null,
    orgUnitId: null,
    payload: { enrollmentId: "demo-enrollment-1", userId: "demo-user" },
    occurredAt: new Date(0).toISOString(),
  });
  return store;
}
