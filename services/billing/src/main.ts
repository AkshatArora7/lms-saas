/**
 * billing service.
 * Plans, per-tenant subscriptions (trialing -> active -> past_due -> canceled),
 * seats and seat enforcement. Sits behind the gateway. The `plan` catalog is
 * control-plane (global); `subscription` is tenant-scoped under RLS.
 *
 * Lightweight Fastify HTTP service. Each request resolves a TenantContext
 * (pool vs silo) and runs domain work through @lms/db.withTenant so Postgres
 * RLS scopes every query. Deployable as a container image (Dockerfile ->
 * GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import Fastify, { type FastifyInstance } from "fastify";

import { registerBillingRoutes, type BillingRouteDeps } from "./routes.js";
import {
  MemoryInvoiceStore,
  MemoryMeterStore,
  MemoryPlanStore,
  MemorySubscriptionStore,
} from "./store.memory.js";
import {
  createPrismaInvoiceStore,
  createPrismaMeterStore,
  createPrismaPlanStore,
  createPrismaSubscriptionStore,
} from "./store.prisma.js";

const SERVICE = "billing";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject in-memory stores. */
export interface BuildAppOptions {
  config?: AppConfig;
  planStore?: BillingRouteDeps["planStore"];
  subscriptionStore?: BillingRouteDeps["subscriptionStore"];
  meterStore?: BillingRouteDeps["meterStore"];
  invoiceStore?: BillingRouteDeps["invoiceStore"];
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

  const planStore = options.planStore ?? createPrismaPlanStore();
  registerBillingRoutes(app, {
    config,
    planStore,
    subscriptionStore:
      options.subscriptionStore ?? createPrismaSubscriptionStore(planStore),
    meterStore: options.meterStore ?? createPrismaMeterStore(),
    invoiceStore: options.invoiceStore ?? createPrismaInvoiceStore(),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4022);

/**
 * Local dev convenience: `BILLING_STORE=memory` runs the service against
 * in-memory stores (seeded plans) so the billing surface works without a
 * Postgres database. Production leaves this unset.
 */
const useMemoryStore = process.env.BILLING_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    let options: BuildAppOptions = {};
    if (useMemoryStore) {
      const planStore = new MemoryPlanStore();
      options = {
        planStore,
        subscriptionStore: new MemorySubscriptionStore(planStore),
        meterStore: new MemoryMeterStore(),
        invoiceStore: new MemoryInvoiceStore(),
      };
    }
    const app = buildApp(options);
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
