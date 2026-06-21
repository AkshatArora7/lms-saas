/**
 * sis service.
 * OneRoster 1.2 roster sync (issue #14): idempotently ingests orgs, users,
 * classes, and enrollments from a school SIS over OneRoster REST into the
 * tenant-scoped domain tables under RLS, recording sourcedId↔internal-id
 * mappings (sis_id_map) and one sis_sync run per sync carrying a conflict/error
 * report for the admin. The OneRoster source is an injectable port so the sync
 * engine is network-free in tests; the store is injectable so it is DB-free.
 *
 * Lightweight Fastify HTTP service. Each request resolves a TenantContext
 * (pool vs silo) and runs domain work through @lms/db.withTenant so Postgres
 * RLS scopes every query. Deployable as a container image (Dockerfile ->
 * GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import type { TenantContext } from "@lms/types";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { createHttpOneRosterClient } from "./oneroster.http.js";
import { registerSisRoutes, type SisRouteDeps } from "./routes.js";
import { MemorySisStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "sis";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject a memory store + a fake client. */
export interface BuildAppOptions {
  config?: AppConfig;
  client?: SisRouteDeps["client"];
  store?: SisRouteDeps["store"];
  resolveTenant?: SisRouteDeps["resolveTenant"];
}

/**
 * Default tenant resolution: the gateway authenticates the request and forwards
 * the verified tenant as `x-tenant-id`.
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

/** Default OneRoster source: REST adapter configured from the environment. */
function defaultOneRosterClient(): SisRouteDeps["client"] {
  return createHttpOneRosterClient({
    baseUrl: process.env.ONEROSTER_BASE_URL ?? "http://localhost:0/oneroster",
    ...(process.env.ONEROSTER_TOKEN ? { token: process.env.ONEROSTER_TOKEN } : {}),
  });
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

  registerSisRoutes(app, {
    client: options.client ?? defaultOneRosterClient(),
    store: options.store ?? createPrismaStore(),
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4019);

/**
 * Local dev convenience: `SIS_STORE=memory` runs the service against an
 * in-memory store so the roster-sync surface works without a Postgres database.
 */
const useMemoryStore = process.env.SIS_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    const store = useMemoryStore ? new MemorySisStore() : undefined;
    const app = buildApp(store ? { store } : {});
    await app.listen({ port, host: "0.0.0.0" });
    log.info(
      { port, store: useMemoryStore ? "memory" : "prisma" },
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
