/**
 * gateway service.
 * Edge API gateway: JWT validation, per-tenant tenant resolution, scope
 * enforcement and routing to domain services (APIM/YARP equivalent).
 *
 * Lightweight Fastify HTTP service. The gateway authenticates every request,
 * resolves the TenantContext from the verified token, and forwards `x-tenant-id`
 * to domain services so each runs its work through @lms/db.withTenant and
 * Postgres RLS scopes every query. Deployable as a container image (Dockerfile
 * -> GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import Fastify, { type FastifyInstance } from "fastify";

import { authGuard, requireScope } from "./auth.js";
import {
  createProxyHandler,
  envUpstreamResolver,
  type ProxyOptions,
} from "./proxy.js";
import {
  createRateLimiter,
  rateLimitGuard,
  type LimitResolver,
  type RateLimiter,
} from "./ratelimit.js";

const SERVICE = "gateway";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject config so no real env is needed. */
export interface BuildAppOptions {
  config?: AppConfig;
  /** Override upstream routing (host map + HTTP client) for tests. */
  proxy?: Partial<ProxyOptions>;
  /** Override the rate limiter (tests inject an in-memory one with a clock). */
  rateLimiter?: RateLimiter;
  /** Override the per-tenant budget resolver (e.g. by plan). */
  limitFor?: LimitResolver;
}

/**
 * Build the Fastify app without binding a port, so tests can drive it via
 * `app.inject(...)`. Config is resolved lazily here (not at import time) to
 * keep the module import side-effect free.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: false });

  // Public: liveness probe, no auth.
  app.get("/health", async () => ({
    service: SERVICE,
    status: "ok",
    tenantMode: config.TENANT_MODE,
    uptime: process.uptime(),
  }));

  const authenticate = authGuard(config);
  // Per-tenant rate limiting runs right after auth (it reads the resolved
  // tenant), so one tenant cannot exhaust capacity for others.
  const limiter = options.rateLimiter ?? createRateLimiter(config);
  const rateLimit = rateLimitGuard({
    limiter,
    config,
    ...(options.limitFor ? { limitFor: options.limitFor } : {}),
  });

  // Authenticated: echoes the identity the gateway resolved from the token.
  app.get(
    "/whoami",
    { preHandler: [authenticate, rateLimit] },
    async (req) => ({
      userId: req.claims!.sub,
      tenantId: req.tenant!.tenantId,
      tier: req.tenant!.tier,
      roles: req.claims!.roles,
      scopes: req.claims!.scopes,
    }),
  );

  // Authenticated + scope-gated example, demonstrating downstream protection.
  app.get(
    "/admin/ping",
    { preHandler: [authenticate, rateLimit, requireScope("users:manage")] },
    async () => ({ ok: true }),
  );

  // Reverse proxy: authenticated `/api/:service/*` requests are forwarded to the
  // owning domain service with the gateway-resolved `x-tenant-id` injected.
  const proxyHandler = createProxyHandler({
    resolveUpstream: options.proxy?.resolveUpstream ?? envUpstreamResolver(),
    fetchImpl: options.proxy?.fetchImpl,
  });
  app.all(
    "/api/:service/*",
    { preHandler: [authenticate, rateLimit] },
    proxyHandler,
  );

  return app;
}

const port = Number(process.env.PORT ?? 4000);

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
