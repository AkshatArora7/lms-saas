/**
 * video service.
 * Lecture-video pipeline: signed direct-to-Blob uploads (tenant-namespaced
 * keys), an injectable async transcode→caption pipeline that drives the
 * `video_asset` lifecycle (uploaded→transcoding→ready), and URL-based adaptive
 * playback (renditions + captions served from Blob/CDN, never proxied). Sits
 * behind the gateway, which forwards the resolved tenant as `x-tenant-id` and
 * the verified caller as `x-user-id`/`x-user-roles` (ADR-0027) so every query
 * runs RLS-scoped. See ADR-0029.
 *
 * Lightweight Fastify HTTP service. Each request resolves a TenantContext
 * (pool vs silo) and runs domain work through @lms/db.withTenant so Postgres
 * RLS scopes every query. Deployable as a container image (Dockerfile ->
 * GHCR -> container host) or, for edge/BFF roles, as Vercel Functions.
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
import {
  DbCourseAccessPolicy,
  FakeCourseAccessPolicy,
  type CourseAccessPolicy,
} from "./access.js";
import { StubCaptioner, type Captioner } from "./captioner.js";
import { InlinePipelineRunner, type PipelineRunner } from "./pipeline.js";
import {
  registerVideoRoutes,
  type Caller,
  type VideoRouteDeps,
} from "./routes.js";
import { MemoryVideoStore } from "./store.memory.js";
import { createPrismaStore } from "./store.prisma.js";
import { StubTranscoder, type Transcoder } from "./transcoder.js";

const SERVICE = "video";
const log = createLogger(SERVICE);

/** Overridable dependencies — tests inject an in-memory store + offline seams. */
export interface BuildAppOptions {
  config?: AppConfig;
  store?: VideoRouteDeps["store"];
  resolveTenant?: VideoRouteDeps["resolveTenant"];
  resolveCaller?: VideoRouteDeps["resolveCaller"];
  blobSigner?: BlobSigner;
  /** Course-scoped read gate (#319); defaults to the RLS-backed Db policy. */
  courseAccessPolicy?: CourseAccessPolicy;
  transcoder?: Transcoder;
  captioner?: Captioner;
  /** Inject a synchronous runner in tests; defaults to fire-and-forget. */
  pipeline?: PipelineRunner;
  maxUploadBytes?: number;
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
 * Default caller resolution: the gateway/BFF stamps the verified identity as
 * `x-user-id` + `x-user-roles`. Throws when `x-user-id` is absent so write
 * routes fail closed with 401.
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
 * `app.inject(...)`. Config is resolved lazily here (not at import time). The
 * transcode/caption pipeline defaults to deterministic offline stubs behind
 * injectable seams (ADR-0028/0029) — so the service boots and tests pass with
 * no FFmpeg, ASR, or network.
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
  const transcoder = options.transcoder ?? new StubTranscoder();
  const captioner = options.captioner ?? new StubCaptioner();
  const pipeline =
    options.pipeline ??
    new InlinePipelineRunner({ store, transcoder, captioner });

  registerVideoRoutes(app, {
    config,
    store,
    resolveTenant: options.resolveTenant ?? headerTenantResolver(config),
    resolveCaller: options.resolveCaller ?? headerCallerResolver(),
    blobSigner: options.blobSigner ?? makeBlobSigner(config),
    courseAccessPolicy:
      options.courseAccessPolicy ?? new DbCourseAccessPolicy(),
    transcoder,
    captioner,
    pipeline,
    ...(options.maxUploadBytes !== undefined
      ? { maxUploadBytes: options.maxUploadBytes }
      : {}),
  });

  return app;
}

const port = Number(process.env.PORT ?? 4020);

/**
 * Local dev convenience: `VIDEO_STORE=memory` runs the service against an
 * in-memory store so the video surface works without a Postgres database.
 */
const useMemoryStore = process.env.VIDEO_STORE === "memory";

async function start(): Promise<void> {
  try {
    if (useMemoryStore) {
      process.env.DATABASE_URL ??= "postgres://demo:demo@localhost:5432/demo";
      process.env.JWT_SECRET ??= "local-dev-secret-not-for-production";
    }
    // Memory dev mode: share one Fake policy between the store's list filter and
    // the route detail gate so they agree (#319).
    const courseAccessPolicy = useMemoryStore
      ? new FakeCourseAccessPolicy()
      : undefined;
    const store = useMemoryStore
      ? new MemoryVideoStore(undefined, undefined, courseAccessPolicy)
      : undefined;
    const app = buildApp(
      store
        ? { store, ...(courseAccessPolicy ? { courseAccessPolicy } : {}) }
        : {},
    );
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
