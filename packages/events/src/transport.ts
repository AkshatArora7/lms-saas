import type { EventEnvelope } from "./index.js";

/**
 * The transport seam between the relay (which drains the outbox) and the
 * consumers (notification fan-out, analytics, …). The relay calls
 * `deliver(envelope)` once per outbox row; an implementation is free to
 * dispatch in-process, POST over HTTP, or enqueue onto a hosted broker.
 *
 * This package stays transport- and DB-agnostic: it owns only the contract and
 * a couple of dependency-light default transports. A future QStash/Upstash
 * transport implements this same interface and reads its credentials from
 * `@lms/config` (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) — it is NOT
 * implemented here and no secret is ever hard-coded.
 */
export interface EventTransport {
  deliver(event: EventEnvelope): Promise<void>;
}

/** A consumer-side handler invoked with a delivered envelope. */
export type EventHandler = (event: EventEnvelope) => Promise<void>;

/** Map of event type -> handlers subscribed to that type. */
export type RoutingTable = Record<string, EventHandler[]>;

/**
 * Default dev/test transport: dispatches each delivered event to every handler
 * registered for its `type` in the routing table. Handlers run sequentially so
 * a throwing handler surfaces to the relay (which then leaves the row
 * unpublished for retry). No external infrastructure required, which is what
 * makes the relay runnable and unit-testable locally.
 */
export class InProcessTransport implements EventTransport {
  constructor(private readonly routes: RoutingTable = {}) {}

  /** Subscribe a handler to an event type (additive; preserves existing ones). */
  on(type: string, handler: EventHandler): void {
    (this.routes[type] ??= []).push(handler);
  }

  async deliver(event: EventEnvelope): Promise<void> {
    const handlers = this.routes[event.type] ?? [];
    for (const handler of handlers) {
      await handler(event);
    }
  }
}

export interface HttpTransportOptions {
  /** Absolute URL of the consumer endpoint (e.g. notification POST /events). */
  url: string;
  /**
   * Build outbound headers from the envelope. The gateway-internal contract is
   * tenant-via-`x-tenant-id`; consumers resolve the tenant from that header.
   */
  headers?: (event: EventEnvelope) => Record<string, string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Minimal HTTP transport that POSTs the envelope as JSON to a single consumer
 * URL using the global `fetch` (no extra dependency). In a real deployment the
 * relay uses this to call the notification service's `POST /events`, forwarding
 * the tenant as `x-tenant-id` so the consumer re-enters the correct RLS scope.
 * A non-2xx response throws, so the relay leaves the row unpublished for retry.
 */
export class HttpTransport implements EventTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly buildHeaders: (event: EventEnvelope) => Record<string, string>;

  constructor(private readonly options: HttpTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.buildHeaders =
      options.headers ?? ((event) => ({ "x-tenant-id": event.tenantId }));
  }

  async deliver(event: EventEnvelope): Promise<void> {
    const res = await this.fetchImpl(this.options.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.buildHeaders(event) },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      throw new Error(
        `HttpTransport: ${this.options.url} responded ${res.status}`,
      );
    }
  }
}
