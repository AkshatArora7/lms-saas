/**
 * mobile-bff service.
 * Backend-for-frontend for the React Native app (issue #79): authenticates with
 * the shared access-token model, aggregates per-screen data from the domain
 * services via the API gateway, and registers devices for push notifications.
 *
 * Unlike the domain services it owns no database — it is a pure composition
 * layer. Deployable as a container image (Dockerfile -> GHCR -> container host)
 * or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import Fastify, { type FastifyInstance } from "fastify";

import { registerMobileRoutes } from "./routes.js";
import { createHttpUpstreamClient, type UpstreamClient } from "./upstream.js";

const SERVICE = "mobile-bff";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject config and a fake upstream client. */
export interface BuildAppOptions {
  config?: AppConfig;
  upstream?: UpstreamClient;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    service: SERVICE,
    status: "ok",
    tenantMode: config.TENANT_MODE,
    uptime: process.uptime(),
  }));

  const upstream =
    options.upstream ??
    createHttpUpstreamClient({
      gatewayUrl: process.env.GATEWAY_URL ?? "http://gateway:4000",
    });

  registerMobileRoutes(app, { config, upstream });

  return app;
}

const port = Number(process.env.PORT ?? 4024);

async function start(): Promise<void> {
  try {
    const app = buildApp();
    await app.listen({ port, host: "0.0.0.0" });
    log.info({ port }, `${SERVICE} service listening`);
  } catch (err) {
    log.error({ err }, `failed to start ${SERVICE} service`);
    process.exit(1);
  }
}

// Boot the HTTP listener only as a real process, never under test (Vitest sets
// VITEST=true) where modules are imported for inspection.
if (!process.env.VITEST) {
  void start();
}
