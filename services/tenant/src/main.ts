/**
 * tenant service.
 * Control plane: tenant catalog (tenant_id -> DSN/region/tier), provisioning saga, pool/silo routing, feature flags, onboarding/offboarding.
 *
 * Lightweight Fastify HTTP service. Unlike tenant-scoped domain services, this
 * is the CONTROL PLANE: it owns the `tenant` registry, which sits OUTSIDE
 * Postgres RLS. Provisioning runs against a control-plane Prisma client (never
 * `withTenant`). Deployable as a container image (Dockerfile -> GHCR ->
 * container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import Fastify, { type FastifyInstance } from "fastify";

import { MemoryBrandingStore } from "./branding.memory.js";
import { createPrismaBrandingStore } from "./branding.prisma.js";
import { createHttpOffboardingPorts } from "./offboarding.http.js";
import {
  registerOffboardingRoutes,
  type OffboardingRouteDeps,
} from "./offboarding.routes.js";
import { registerTenantRoutes, type TenantRouteDeps } from "./routes.js";
import { MemorySettingsStore } from "./settings.memory.js";
import { createPrismaSettingsStore } from "./settings.prisma.js";
import { createSeededMemoryStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "tenant";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject in-memory stores. */
export interface BuildAppOptions {
  config?: AppConfig;
  store?: TenantRouteDeps["store"];
  settingsStore?: TenantRouteDeps["settingsStore"];
  brandingStore?: TenantRouteDeps["brandingStore"];
  /** Offboarding ports (#7); tests inject fakes. */
  offboardingPorts?: OffboardingRouteDeps["ports"];
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

  const store = options.store ?? createPrismaStore();
  registerTenantRoutes(app, {
    config,
    store,
    settingsStore: options.settingsStore ?? createPrismaSettingsStore(),
    brandingStore: options.brandingStore ?? createPrismaBrandingStore(),
  });
  registerOffboardingRoutes(app, {
    store,
    ports:
      options.offboardingPorts ??
      createHttpOffboardingPorts({
        gatewayUrl: process.env.GATEWAY_URL ?? "http://gateway:4000",
      }),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4002);

/**
 * Local dev convenience: `TENANT_STORE=memory` runs the service against an
 * in-memory control-plane registry seeded with a demo tenant, so the
 * provisioning surface works without a Postgres database. Production leaves
 * this unset.
 */
const useMemoryStore = process.env.TENANT_STORE === "memory";

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
            settingsStore: new MemorySettingsStore(),
            brandingStore: new MemoryBrandingStore(),
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
