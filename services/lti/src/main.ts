/**
 * lti service.
 * LTI 1.3 Platform + Tool: OIDC login, AGS, NRPS, Deep Linking 2.0, Dynamic
 * Registration. Also owns the embeddable course/widget surface (issue #13):
 * signed, short-lived iframe embeds for school portals.
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
import { createRemoteJWKSet } from "jose";

import { registerEmbedRoutes, type EmbedRouteDeps } from "./embed.routes.js";
import type {
  Clock,
  JwksResolver,
  JwksResolverFactory,
} from "./lti.js";
import { registerLtiRoutes } from "./lti.routes.js";
import { createPrismaStore } from "./store.prisma.js";
import type { LtiStore } from "./store.js";

const SERVICE = "lti";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject config, tenant resolution, and URLs. */
export interface BuildAppOptions {
  config?: AppConfig;
  resolveTenant?: EmbedRouteDeps["resolveTenant"];
  /** Absolute base URL the widget is served from (to build embed URLs). */
  publicBaseUrl?: string;
  /** Base URL of the learner app the widget links out to. */
  launchBaseUrl?: string;
  /** LTI launch store — tests inject a MemoryLtiStore; prod uses Prisma. */
  store?: LtiStore;
  /** JWKS resolver factory — tests inject a local-keyset fake. */
  jwksFactory?: JwksResolverFactory;
  /** Clock — tests inject a fixed clock for deterministic exp/nonce checks. */
  clock?: Clock;
}

/**
 * Real JWKS factory: one remote keyset per platform jwks_url, cached. The
 * keyset is `createRemoteJWKSet`, whose call signature matches `JwksResolver`.
 */
function remoteJwksFactory(): JwksResolverFactory {
  const cache = new Map<string, JwksResolver>();
  return {
    forJwksUrl(jwksUrl: string): JwksResolver {
      let resolver = cache.get(jwksUrl);
      if (!resolver) {
        resolver = createRemoteJWKSet(new URL(jwksUrl)) as unknown as JwksResolver;
        cache.set(jwksUrl, resolver);
      }
      return resolver;
    },
  };
}

/**
 * Default tenant resolution: the gateway authenticates the request and forwards
 * the verified tenant as `x-tenant-id`. Used by the embed-token mint endpoint;
 * the public widget render path trusts only the signed token, not this header.
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

  registerEmbedRoutes(app, {
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
    secret: config.JWT_SECRET,
    ...(config.JWT_ISSUER ? { issuer: config.JWT_ISSUER } : {}),
    ...(options.publicBaseUrl !== undefined
      ? { publicBaseUrl: options.publicBaseUrl }
      : process.env.EMBED_PUBLIC_URL
        ? { publicBaseUrl: process.env.EMBED_PUBLIC_URL }
        : {}),
    ...(options.launchBaseUrl !== undefined
      ? { launchBaseUrl: options.launchBaseUrl }
      : process.env.EMBED_LAUNCH_URL
        ? { launchBaseUrl: process.env.EMBED_LAUNCH_URL }
        : {}),
  });

  const launchBaseUrl =
    options.launchBaseUrl ?? process.env.LTI_LAUNCH_URL ?? process.env.EMBED_LAUNCH_URL;
  const publicBaseUrl =
    options.publicBaseUrl ?? process.env.LTI_PUBLIC_URL ?? process.env.EMBED_PUBLIC_URL;

  registerLtiRoutes(app, {
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
    store: options.store ?? createPrismaStore(),
    jwksFactory: options.jwksFactory ?? remoteJwksFactory(),
    clock: options.clock ?? (() => new Date()),
    secret: config.JWT_SECRET,
    audience: config.JWT_AUDIENCE,
    ...(config.JWT_ISSUER ? { issuer: config.JWT_ISSUER } : {}),
    ...(launchBaseUrl !== undefined ? { launchBaseUrl } : {}),
    ...(publicBaseUrl !== undefined ? { publicBaseUrl } : {}),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4018);

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
