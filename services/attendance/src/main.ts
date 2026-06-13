/**
 * attendance service.
 * Class attendance and participation: per-tenant attendance codes, attendance
 * sessions (one per section meeting), per-student records, and summaries/exports
 * for compliance and SIS. Rosters are derived from section enrollment and the
 * timetable. Emits attendance events for notifications and analytics.
 *
 * Lightweight Fastify HTTP service. Each request resolves a TenantContext
 * (pool vs silo) and runs domain work through @lms/db.withTenant so Postgres
 * RLS scopes every query. Deployable as a container image (Dockerfile ->
 * GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import Fastify, { type FastifyInstance } from "fastify";

const SERVICE = "attendance";
const log = createLogger(SERVICE);

/**
 * Build the Fastify app without binding a port, so tests can drive it via
 * `app.inject(...)`. Config is resolved lazily here (not at import time) to
 * keep the module import side-effect free.
 */
export function buildApp(): FastifyInstance {
  const config = loadConfig();
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    service: SERVICE,
    status: "ok",
    tenantMode: config.TENANT_MODE,
    uptime: process.uptime(),
  }));

  // TODO: register domain routes (see /docs/services/attendance.md): attendance
  // codes, sessions, records, and summaries. Tenant-resolution middleware and
  // RLS-scoped handlers are added per bounded context.

  return app;
}

const port = Number(process.env.PORT ?? 4025);

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
