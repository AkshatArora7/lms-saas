import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { EventEnvelope } from "./index.js";
import { OutboxPublisher } from "./publisher.js";
import { InProcessTransport, type EventTransport } from "./transport.js";

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: randomUUID(),
    type: "enrollment.created",
    tenantId: randomUUID(),
    occurredAt: new Date().toISOString(),
    actorId: null,
    orgUnitId: null,
    version: 1,
    payload: { foo: "bar" },
    ...overrides,
  };
}

describe("InProcessTransport", () => {
  it("routes an event only to handlers registered for its type", async () => {
    const enrollmentSeen: EventEnvelope[] = [];
    const gradeSeen: EventEnvelope[] = [];
    const transport = new InProcessTransport();
    transport.on("enrollment.created", async (e) => {
      enrollmentSeen.push(e);
    });
    transport.on("grade.released", async (e) => {
      gradeSeen.push(e);
    });

    const e = envelope({ type: "enrollment.created" });
    await transport.deliver(e);

    expect(enrollmentSeen).toHaveLength(1);
    expect(enrollmentSeen[0]!.id).toBe(e.id);
    expect(gradeSeen).toHaveLength(0);
  });

  it("dispatches to every handler registered for a type", async () => {
    const calls: string[] = [];
    const transport = new InProcessTransport({
      "grade.released": [
        async () => {
          calls.push("a");
        },
        async () => {
          calls.push("b");
        },
      ],
    });
    await transport.deliver(envelope({ type: "grade.released" }));
    expect(calls).toEqual(["a", "b"]);
  });

  it("is a no-op for an event type with no handlers", async () => {
    const transport = new InProcessTransport();
    await expect(
      transport.deliver(envelope({ type: "unknown.type" })),
    ).resolves.toBeUndefined();
  });
});

describe("OutboxPublisher", () => {
  it("validates the envelope and delivers it via the transport", async () => {
    const delivered: EventEnvelope[] = [];
    const transport: EventTransport = {
      async deliver(e) {
        delivered.push(e);
      },
    };
    const publisher = new OutboxPublisher(transport);
    const e = envelope();
    await publisher.publish(e);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.id).toBe(e.id);
  });

  it("rejects (and does not deliver) a malformed envelope", async () => {
    let deliveries = 0;
    const transport: EventTransport = {
      async deliver() {
        deliveries += 1;
      },
    };
    const publisher = new OutboxPublisher(transport);
    // tenantId is not a uuid -> schema rejects before delivery.
    const bad = envelope({ tenantId: "not-a-uuid" });
    await expect(publisher.publish(bad)).rejects.toThrow();
    expect(deliveries).toBe(0);
  });
});
