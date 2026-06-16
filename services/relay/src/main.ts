/**
 * relay service — transactional-outbox publisher / relay.
 *
 * Drains `event_outbox` and publishes each row through a transport to the
 * platform's event consumers (notification fan-out today; analytics next).
 * It is a long-running worker, not a request/response service: the Fastify app
 * exists only to expose `/health` (and a manual `/relay/run` trigger) so the
 * container has a liveness endpoint and ops can force a pass.
 *
 * Tenant safety: the outbox is under FORCE ROW LEVEL SECURITY, so the relay
 * NEVER reads it cross-tenant. It enumerates tenants from the control-plane
 * registry and drains each one inside its own `app.tenant_id` GUC transaction
 * via @lms/db.withTenant — see store.prisma.ts for the rationale.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import {
  InProcessTransport,
  OutboxPublisher,
  type EventTransport,
} from "@lms/events";
import { createLogger } from "@lms/logger";
import Fastify, { type FastifyInstance } from "fastify";

import {
  notificationConsumerHandler,
  fanOutRequestFromEvent,
} from "./consumer.js";
import { OutboxRelay, type OutboxRelayStore } from "./store.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "relay";
const log = createLogger(SERVICE);

export interface BuildAppOptions {
  config?: AppConfig;
  /** Inject a store/transport for tests; production builds the prisma stack. */
  relay?: OutboxRelay;
  store?: OutboxRelayStore;
  transport?: EventTransport;
}

/**
 * Wire the default production relay: an HttpTransport that POSTs each envelope
 * to the notification service's `POST /events`, with consumer-side dedupe via
 * `event_inbox`. The InProcessTransport branch is used by `RELAY_STORE=memory`
 * and tests. The publisher validates every envelope before delivery.
 */
function buildDefaultRelay(config: AppConfig): OutboxRelay {
  const store = createPrismaStore({
    tier: config.DEFAULT_TENANT_TIER,
    databaseUrl: config.DATABASE_URL,
  });

  // The relay calls the notification consumer over HTTP. Dedupe is enforced
  // INSIDE the notification service: it claims (consumer, message_id) in
  // event_inbox AND inserts notifications in one transaction, so a redelivery
  // is an idempotent no-op (it still returns 2xx → the relay stamps the row).
  const notificationUrl =
    process.env.NOTIFICATION_EVENTS_URL ?? "http://notification:4012/events";
  const notify = notificationConsumerHandler(async (event) => {
    const request = fanOutRequestFromEvent(event);
    if (!request) return; // no recipients — nothing to notify.
    // Build the body the notification /events handler parses: top-level
    // message_id (the event id, for dedupe), type, title, recipientIds, data.
    // Forward x-tenant-id so the consumer re-enters the correct RLS scope.
    const res = await fetch(notificationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": event.tenantId,
      },
      body: JSON.stringify({
        message_id: event.id,
        tenantId: event.tenantId,
        type: request.type,
        title: request.title,
        recipientIds: request.recipientIds,
        data: request.data,
      }),
    });
    if (!res.ok) {
      // Non-2xx → leave the outbox row unpublished; the next pass retries.
      throw new Error(
        `notification fan-out: ${notificationUrl} responded ${res.status}`,
      );
    }
  });

  const transport = new InProcessTransport();
  transport.on("enrollment.created", notify);
  transport.on("grade.released", notify);

  const publisher = new OutboxPublisher(transport);
  // The relay delivers through the publisher so envelopes are validated.
  return new OutboxRelay(store, { deliver: (e) => publisher.publish(e) });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: false });

  const relay =
    options.relay ??
    (options.store && options.transport
      ? new OutboxRelay(options.store, options.transport)
      : buildDefaultRelay(config));

  app.get("/health", async () => ({
    service: SERVICE,
    status: "ok",
    tenantMode: config.TENANT_MODE,
    uptime: process.uptime(),
  }));

  // Manual trigger for ops/tests; the loop runs the same runOnce on a timer.
  app.post("/relay/run", async (_req, reply) => {
    const summary = await relay.runOnce();
    return reply.code(200).send(summary);
  });

  app.decorate("relay", relay);
  return app;
}

const port = Number(process.env.PORT ?? 4026);
const pollIntervalMs = Number(process.env.RELAY_POLL_INTERVAL_MS ?? 5000);
const useMemoryStore = process.env.RELAY_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    const config = loadConfig();
    const relay = buildDefaultRelay(config);
    const app = buildApp({ config, relay });
    await app.listen({ port, host: "0.0.0.0" });
    const stop = relay.runForever(pollIntervalMs, (err) =>
      log.error({ err }, "relay pass failed"),
    );
    const shutdown = (): void => {
      stop();
      void app.close();
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    log.info({ port, pollIntervalMs }, `${SERVICE} service listening`);
  } catch (err) {
    log.error({ err }, `failed to start ${SERVICE} service`);
    process.exit(1);
  }
}

declare module "fastify" {
  interface FastifyInstance {
    relay: OutboxRelay;
  }
}

if (!process.env.VITEST) {
  void start();
}
