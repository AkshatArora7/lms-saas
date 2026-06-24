/**
 * attendance service.
 * Class attendance and participation: per-tenant attendance codes, attendance
 * sessions (one per section meeting), per-student records, and summaries/exports
 * for compliance and SIS. Rosters are derived from section enrollment and the
 * timetable. Sits behind the gateway, which authenticates requests and forwards
 * the resolved tenant as `x-tenant-id`. Emits attendance events for
 * notifications and analytics.
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

import { createHttpEnrollmentRosterResolver } from "./enrollment-resolver.http.js";
import type { EnrollmentRosterResolver } from "./enrollment-resolver.js";
import { createHttpGuardianChildrenResolver } from "./guardian-resolver.http.js";
import { createHttpStudentGuardiansResolver } from "./guardians.http.js";
import type { StudentGuardiansResolver } from "./guardians.js";
import {
  registerAttendanceRoutes,
  type AttendanceRouteDeps,
  type Caller,
} from "./routes.js";
import { createSeededMemoryStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "attendance";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject an in-memory store. */
export interface BuildAppOptions {
  config?: AppConfig;
  store?: AttendanceRouteDeps["store"];
  resolveTenant?: AttendanceRouteDeps["resolveTenant"];
  /**
   * Resolves a student's notifiable guardians for the absence/tardy fan-out
   * (#101). Defaults to the gateway-backed HTTP resolver; tests inject a fake.
   * Ignored when `store` is supplied (the store already has its resolver).
   */
  guardiansResolver?: StudentGuardiansResolver;
  /**
   * Resolves a section's active roster to seed records on session create
   * (#376). Defaults to the gateway-backed HTTP resolver; tests inject a fake.
   * Ignored when `store` is supplied (the store already has its resolver).
   */
  enrollmentResolver?: EnrollmentRosterResolver;
  resolveCaller?: AttendanceRouteDeps["resolveCaller"];
  guardianResolver?: AttendanceRouteDeps["guardianResolver"];
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
 * Default caller resolution for the guardian-scoped view (#190): the
 * gateway/BFF stamps the verified identity as `x-user-id`. Throws when it is
 * absent so the guardian routes fail closed with 401. The guardian is NEVER a
 * client-supplied param — only this trusted header identifies the caller.
 */
function headerCallerResolver(): (req: FastifyRequest) => Caller {
  return (req) => {
    const userId = req.headers["x-user-id"];
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("missing x-user-id");
    }
    const rolesHeader = req.headers["x-user-roles"];
    const raw = Array.isArray(rolesHeader)
      ? rolesHeader.join(",")
      : (rolesHeader ?? "");
    const roles = raw
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    return { userId, roles };
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

  const guardiansResolver =
    options.guardiansResolver ??
    createHttpStudentGuardiansResolver({
      gatewayUrl: process.env.GATEWAY_URL ?? "http://gateway:4000",
    });

  const enrollmentResolver =
    options.enrollmentResolver ??
    createHttpEnrollmentRosterResolver({
      // Section enrollment authority lives in the enrollment context, reached
      // through the gateway (same convention as the guardian resolvers).
      gatewayUrl: process.env.GATEWAY_URL ?? "http://gateway:4000",
    });

  registerAttendanceRoutes(app, {
    config,
    store:
      options.store ??
      createPrismaStore(randomUUID, guardiansResolver, enrollmentResolver),
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
    resolveCaller: options.resolveCaller ?? headerCallerResolver(),
    guardianResolver:
      options.guardianResolver ??
      createHttpGuardianChildrenResolver({
        // Guardian relationship + consent authority lives in user-org, reached
        // through the gateway (same convention as tenant's offboarding ports).
        gatewayUrl: process.env.GATEWAY_URL ?? "http://gateway:4000",
      }),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4025);

/**
 * Local dev convenience: `ATTENDANCE_STORE=memory` runs the service against an
 * in-memory store seeded with the default attendance codes so the gateway ->
 * attendance path works end-to-end without a Postgres database. Production
 * leaves this unset.
 */
const useMemoryStore = process.env.ATTENDANCE_STORE === "memory";

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
