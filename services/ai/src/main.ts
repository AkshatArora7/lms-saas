/**
 * ai service.
 * AI study assistant: embeds a course's content (pgvector) and answers student
 * questions via Groq RAG with citations, grounded only in retrieved chunks.
 * Tenant-isolated by Postgres RLS. Sits behind the gateway, which authenticates
 * requests and forwards the resolved tenant as `x-tenant-id` and the verified
 * caller as `x-user-id` (ADR-0027).
 *
 * Lightweight Fastify HTTP service. Each request resolves a TenantContext
 * (pool vs silo) and runs domain work through @lms/db.withTenant so Postgres
 * RLS scopes every query. Deployable as a container image (Dockerfile ->
 * GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import { createRateLimiter } from "@lms/ratelimit";
import type { TenantContext } from "@lms/types";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { makeChatModel } from "./chat.js";
import { makeEmbedder } from "./embedder.js";
import { registerAiRoutes, type AiRouteDeps } from "./routes.js";
import { createSeededMemoryStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "ai";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject an in-memory store + fake embedder/chat. */
export interface BuildAppOptions {
  config?: AppConfig;
  store?: AiRouteDeps["store"];
  resolveTenant?: AiRouteDeps["resolveTenant"];
  embedder?: AiRouteDeps["embedder"];
  chat?: AiRouteDeps["chat"];
  limiter?: AiRouteDeps["limiter"];
}

/**
 * Default tenant resolution: the gateway authenticates the request and forwards
 * the verified tenant as `x-tenant-id`. Pool tenants share DATABASE_URL; silo
 * routing is resolved upstream and is out of scope for a domain service.
 */
function headerTenantResolver(
  config: AppConfig,
): (req: FastifyRequest) => TenantContext {
  return (req) => {
    const tenantId = req.headers["x-tenant-id"];
    if (typeof tenantId !== "string" || tenantId.length === 0) {
      throw new Error("missing x-tenant-id");
    }
    return {
      tenantId,
      tier: config.DEFAULT_TENANT_TIER,
      databaseUrl: config.DATABASE_URL,
    };
  };
}

/**
 * Build the Fastify app without binding a port, so tests can drive it via
 * `app.inject(...)`. Config is resolved lazily here (not at import time) to
 * keep the module import side-effect free. The chat model defaults to Groq when
 * `GROQ_API_KEY` is set, else a deterministic offline fake — so the service
 * boots (and tests pass) with no key or network.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    service: SERVICE,
    status: "ok",
    tenantMode: config.TENANT_MODE,
    uptime: process.uptime(),
  }));

  registerAiRoutes(app, {
    config,
    store: options.store ?? createPrismaStore(),
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
    embedder: options.embedder ?? makeEmbedder(),
    chat: options.chat ?? makeChatModel(config),
    limiter: options.limiter ?? createRateLimiter(config),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4017);

/**
 * Local dev convenience: `AI_STORE=memory` runs the service against an in-memory
 * store seeded with demo course content so the gateway -> ai path works
 * end-to-end without a Postgres database. Production leaves this unset.
 */
const useMemoryStore = process.env.AI_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    const store = useMemoryStore ? createSeededMemoryStore() : undefined;
    const app = buildApp(store ? { store } : {});
    await app.listen({ port, host: "0.0.0.0" });
    log.info(
      { port, store: useMemoryStore ? "memory(demo)" : "prisma" },
      `${SERVICE} service listening`,
    );
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
