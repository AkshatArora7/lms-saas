/**
 * content service.
 * Course content authoring: modules/units and topics (ordered), direct-to-Blob
 * file uploads (signed URLs, tenant-namespaced keys), and release/availability
 * conditions. Sits behind the gateway, which forwards the resolved tenant as
 * `x-tenant-id` so every query runs RLS-scoped.
 *
 * Lightweight Fastify HTTP service. Deployable as a container image (Dockerfile
 * -> GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
 */
import { makeBlobSigner } from "@lms/blob";
import { loadConfig, type AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";
import type { TenantContext } from "@lms/types";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

import { type BlobSigner } from "./blob.js";
import { registerContentRoutes, type ContentRouteDeps } from "./routes.js";
import { MemoryContentStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";

const SERVICE = "content";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject an in-memory store + dev signer. */
export interface BuildAppOptions {
  config?: AppConfig;
  store?: ContentRouteDeps["store"];
  resolveTenant?: ContentRouteDeps["resolveTenant"];
  blobSigner?: BlobSigner;
  maxUploadBytes?: number;
}

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
 * `app.inject(...)`. Config is resolved lazily here (not at import time).
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

  registerContentRoutes(app, {
    config,
    store: options.store ?? createPrismaStore(),
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
    blobSigner: options.blobSigner ?? makeBlobSigner(config),
    ...(options.maxUploadBytes !== undefined
      ? { maxUploadBytes: options.maxUploadBytes }
      : {}),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4006);

/**
 * Local dev convenience: `CONTENT_STORE=memory` runs the service against an
 * in-memory store so the content surface works without a Postgres database.
 */
const useMemoryStore = process.env.CONTENT_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    const store = useMemoryStore ? new MemoryContentStore() : undefined;
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
