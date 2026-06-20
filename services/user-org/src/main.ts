/**
 * user-org service.
 * Profiles and the org-unit hierarchy (organization -> department -> semester
 * -> course template -> offering -> section/group). Mirrors OneRoster orgs/
 * users. Sits behind the gateway, which authenticates requests and forwards the
 * resolved tenant as `x-tenant-id`. Read-heavy; the backbone other services
 * query against.
 *
 * Lightweight Fastify HTTP service. Each request resolves a TenantContext
 * (pool vs silo) and runs domain work through @lms/db.withTenant so Postgres
 * RLS scopes every query. Deployable as a container image (Dockerfile ->
 * GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import type { TenantContext } from "@lms/types";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

import { MemoryConsentStore } from "./consent.memory.js";
import { createPrismaConsentStore } from "./consent.prisma.js";
import { registerConsentRoutes, type ConsentRouteDeps } from "./consent.routes.js";
import { MemoryGuardianStore } from "./guardian.memory.js";
import { createPrismaGuardianStore } from "./guardian.prisma.js";
import { registerGuardianRoutes, type GuardianRouteDeps } from "./guardian.routes.js";
import { registerUserOrgRoutes, type UserOrgRouteDeps } from "./routes.js";
import { createSeededMemoryStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "user-org";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject an in-memory store. */
export interface BuildAppOptions {
  config?: AppConfig;
  store?: UserOrgRouteDeps["store"];
  resolveTenant?: UserOrgRouteDeps["resolveTenant"];
  /** Parental-consent store (#77); tests inject memory. */
  consentStore?: ConsentRouteDeps["store"];
  /** Guardian-relationship store (#24); tests inject memory. */
  guardianStore?: GuardianRouteDeps["store"];
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

  const resolveTenant = options.resolveTenant ?? headerTenantResolver(config);
  registerUserOrgRoutes(app, {
    config,
    store: options.store ?? createPrismaStore(),
    resolveTenant,
  });
  const consentStore = options.consentStore ?? createPrismaConsentStore();
  registerConsentRoutes(app, {
    store: consentStore,
    resolveTenant,
  });
  registerGuardianRoutes(app, {
    store: options.guardianStore ?? createPrismaGuardianStore(),
    consentStore,
    resolveTenant,
  });

  return app;
}

const port = Number(process.env.PORT ?? 4003);

/**
 * Local dev convenience: `USER_ORG_STORE=memory` runs the service against an
 * in-memory store seeded with a demo org tree so the gateway -> user-org path
 * works end-to-end without a Postgres database. Production leaves this unset.
 */
const useMemoryStore = process.env.USER_ORG_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    const app = buildApp(
      useMemoryStore
        ? {
            store: createSeededMemoryStore(),
            consentStore: new MemoryConsentStore(),
            guardianStore: new MemoryGuardianStore(),
          }
        : {},
    );
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
