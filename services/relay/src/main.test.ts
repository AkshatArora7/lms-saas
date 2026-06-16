import { randomUUID } from "node:crypto";

import type { AppConfig } from "@lms/config";
import type { EventEnvelope } from "@lms/events";
import { describe, expect, it } from "vitest";

import { notificationConsumerHandler } from "./consumer.js";
import { DEMO_TENANT_ID, MemoryOutboxRelayStore } from "./store.memory.js";
import { OutboxRelay } from "./store.js";

const TENANT_A = DEMO_TENANT_ID;
const TENANT_B = "22222222-2222-2222-2222-222222222222";

/** A transport that records every delivered envelope (test double). */
function recordingTransport() {
  const delivered: EventEnvelope[] = [];
  return {
    delivered,
    transport: {
      async deliver(e: EventEnvelope) {
        delivered.push(e);
      },
    },
  };
}

describe("OutboxRelay.runOnce", () => {
  it("publishes unpublished rows oldest-first and stamps publishedAt", async () => {
    const store = new MemoryOutboxRelayStore();
    const older = store.seedOutbox({
      tenantId: TENANT_A,
      type: "enrollment.created",
      payload: { recipientIds: ["u1"], title: "Older" },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = store.seedOutbox({
      tenantId: TENANT_A,
      type: "grade.released",
      payload: { recipientIds: ["u1"], title: "Newer" },
      occurredAt: "2026-02-01T00:00:00.000Z",
    });

    const { delivered, transport } = recordingTransport();
    const relay = new OutboxRelay(store, transport);

    const summary = await relay.runOnce();

    expect(summary).toEqual({ tenants: 1, published: 2 });
    // Oldest-first ordering.
    expect(delivered.map((e) => e.id)).toEqual([older, newer]);
    expect(store.publishedAt(older)).not.toBeNull();
    expect(store.publishedAt(newer)).not.toBeNull();
  });

  it("a second runOnce publishes nothing (rows already stamped)", async () => {
    const store = new MemoryOutboxRelayStore();
    store.seedOutbox({
      tenantId: TENANT_A,
      type: "enrollment.created",
      payload: { recipientIds: ["u1"] },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    const { delivered, transport } = recordingTransport();
    const relay = new OutboxRelay(store, transport);

    const first = await relay.runOnce();
    const second = await relay.runOnce();

    expect(first.published).toBe(1);
    expect(second.published).toBe(0);
    expect(delivered).toHaveLength(1);
  });

  it("drains each tenant only within its own scope (isolation)", async () => {
    const store = new MemoryOutboxRelayStore();
    store.seedOutbox({
      tenantId: TENANT_A,
      type: "enrollment.created",
      payload: { recipientIds: ["a"] },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    store.seedOutbox({
      tenantId: TENANT_B,
      type: "enrollment.created",
      payload: { recipientIds: ["b"] },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });

    const { delivered, transport } = recordingTransport();
    const relay = new OutboxRelay(store, transport);
    const summary = await relay.runOnce();

    expect(summary).toEqual({ tenants: 2, published: 2 });
    // Every delivered envelope carries exactly one tenant id; never mixed.
    expect(new Set(delivered.map((e) => e.tenantId))).toEqual(
      new Set([TENANT_A, TENANT_B]),
    );
  });

  it("leaves a row unpublished when delivery throws (retry next pass)", async () => {
    const store = new MemoryOutboxRelayStore();
    const id = store.seedOutbox({
      tenantId: TENANT_A,
      type: "enrollment.created",
      payload: { recipientIds: ["u1"] },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });

    let attempts = 0;
    const transport = {
      async deliver() {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
      },
    };
    const relay = new OutboxRelay(store, transport);

    await expect(relay.runOnce()).rejects.toThrow("transient");
    expect(store.publishedAt(id)).toBeNull();

    // Second pass succeeds and stamps it.
    const summary = await relay.runOnce();
    expect(summary.published).toBe(1);
    expect(store.publishedAt(id)).not.toBeNull();
  });
});

describe("notification consumer atomic dedupe (event_inbox)", () => {
  function envelope(): EventEnvelope {
    return {
      id: randomUUID(),
      type: "enrollment.created",
      tenantId: TENANT_A,
      occurredAt: new Date().toISOString(),
      actorId: null,
      orgUnitId: null,
      version: 1,
      payload: { recipientIds: ["u1"], title: "Enrolled" },
    };
  }

  /**
   * Faithful in-memory model of the notification service's atomic
   * claim-and-apply (`ingestEvent`): in one logical transaction it claims
   * `(consumer, message_id)` AND runs the side-effect. The claim is only
   * committed once the effect succeeds — so if `effect` throws, NEITHER the
   * claim NOR the notification persists, exactly like ON CONFLICT + same-tx
   * INSERT rolling back together. A redelivery of a committed id is a no-op.
   */
  class AtomicNotificationConsumer {
    readonly notifications: string[] = [];
    private readonly claims = new Set<string>();
    constructor(private readonly effect?: (id: string) => void) {}

    async ingest(messageId: string): Promise<void> {
      if (this.claims.has(messageId)) return; // redelivery — no-op.
      // Effect runs first; if it throws we never record the claim or the row,
      // and the relay leaves the outbox row unpublished for the next pass.
      if (this.effect) this.effect(messageId);
      this.notifications.push(messageId);
      this.claims.add(messageId);
    }
  }

  it("loses nothing when the consumer fails then is redelivered (exactly-once)", async () => {
    let attempts = 0;
    const consumer = new AtomicNotificationConsumer(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient consumer failure");
    });
    const handler = notificationConsumerHandler((e) => consumer.ingest(e.id));
    const e = envelope();

    // Pass 1: the consumer fails AFTER the claim attempt, but atomically — so
    // nothing persists: zero notifications and the claim is NOT recorded.
    await expect(handler(e)).rejects.toThrow("transient consumer failure");
    expect(consumer.notifications).toEqual([]);

    // Pass 2: the relay redelivers the same id; now it succeeds exactly once.
    await handler(e);
    expect(consumer.notifications).toEqual([e.id]);
  });

  it("delivering the same id twice successfully creates exactly one notification", async () => {
    const consumer = new AtomicNotificationConsumer();
    const handler = notificationConsumerHandler((e) => consumer.ingest(e.id));

    const e = envelope();
    await handler(e);
    await handler(e); // redelivery — idempotent no-op.

    expect(consumer.notifications).toEqual([e.id]);
  });

  it("skips events that name no recipients (no fan-out call)", async () => {
    const consumer = new AtomicNotificationConsumer();
    const handler = notificationConsumerHandler((e) => consumer.ingest(e.id));

    const e = envelope();
    e.payload = {}; // no recipientIds.
    await handler(e);

    expect(consumer.notifications).toEqual([]);
  });

  it("processes distinct events independently", async () => {
    const consumer = new AtomicNotificationConsumer();
    const handler = notificationConsumerHandler((e) => consumer.ingest(e.id));

    const e1 = envelope();
    const e2 = envelope();
    await handler(e1);
    await handler(e2);

    expect(consumer.notifications).toEqual([e1.id, e2.id]);
  });
});

describe("buildApp", () => {
  it("serves /health and triggers a relay pass via POST /relay/run", async () => {
    const { buildApp } = await import("./main.js");
    const store = new MemoryOutboxRelayStore();
    store.seedOutbox({
      tenantId: TENANT_A,
      type: "enrollment.created",
      payload: { recipientIds: ["u1"] },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    const { transport } = recordingTransport();
    const config = {
      TENANT_MODE: "hybrid",
      DEFAULT_TENANT_TIER: "pool",
      DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
    } as unknown as AppConfig;
    const app = buildApp({ config, store, transport });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ service: "relay", status: "ok" });

    const run = await app.inject({ method: "POST", url: "/relay/run" });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toEqual({ tenants: 1, published: 1 });

    await app.close();
  });
});
