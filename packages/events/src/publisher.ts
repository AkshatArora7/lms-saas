import { EventEnvelope } from "./index.js";
import type { EventPublisher } from "./index.js";
import type { EventTransport } from "./transport.js";

/**
 * Concrete `EventPublisher` the relay calls once per outbox row. It validates
 * the envelope against the canonical `EventEnvelope` zod schema (so a malformed
 * row never escapes the relay) and delegates delivery to the injected
 * transport. It holds no DB or transport-specific logic — swapping
 * `InProcessTransport` for an HTTP or QStash transport requires no change here.
 */
export class OutboxPublisher implements EventPublisher {
  constructor(private readonly transport: EventTransport) {}

  async publish(event: EventEnvelope): Promise<void> {
    // Parse (not just assert) so defaults like `version` are applied and an
    // invalid row throws before delivery — leaving it unpublished for retry.
    const validated = EventEnvelope.parse(event);
    await this.transport.deliver(validated);
  }
}
