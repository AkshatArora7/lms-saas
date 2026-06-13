/**
 * identity service.
 * Auth orchestration and token issuance for the LMS platform: local password
 * login, rotating refresh tokens (with token-family reuse detection), and an
 * access-token introspection endpoint. SSO federation (OIDC/SAML) and external
 * CIAM remain future work; this service owns the first-party auth surface.
 *
 * Lightweight Fastify HTTP service. Each request resolves a TenantContext
 * (pool vs silo) and runs domain work through @lms/db.withTenant so Postgres
 * RLS scopes every query. Deployable as a container image (Dockerfile ->
 * GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { randomUUID } from "node:crypto";

import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import type { TenantContext } from "@lms/types";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

import { registerAuthRoutes, type IdentityRouteDeps } from "./routes.js";
import { createSeededMemoryStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "identity";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject an in-memory store + fixed clock. */
export interface BuildAppOptions {
  config?: AppConfig;
  store?: IdentityRouteDeps["store"];
  resolveTenant?: IdentityRouteDeps["resolveTenant"];
  now?: () => Date;
  generateId?: () => string;
  oidcExchanger?: IdentityRouteDeps["oidcExchanger"];
}

/**
 * Default tenant resolution: the API gateway authenticates the tenant and
 * forwards it as `x-tenant-id`. Pool tenants share DATABASE_URL; silo routing
 * is resolved upstream and is out of scope for the auth surface.
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
 * keep the module import side-effect free.
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

  registerAuthRoutes(app, {
    config,
    store: options.store ?? createPrismaStore(),
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
    now: options.now ?? (() => new Date()),
    generateId: options.generateId ?? randomUUID,
    oidcExchanger: options.oidcExchanger,
  });

  return app;
}

const port = Number(process.env.PORT ?? 4001);

/**
 * Local dev convenience: `IDENTITY_STORE=memory` runs the auth surface against
 * an in-memory store seeded with demo accounts so the web/admin sign-in flow
 * works end-to-end without a Postgres database. Production leaves this unset and
 * uses the RLS-backed Prisma store.
 */
const useMemoryStore = process.env.IDENTITY_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      // Supply throwaway defaults so loadConfig() succeeds without real infra.
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    const store = useMemoryStore ? await createSeededMemoryStore() : undefined;
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
