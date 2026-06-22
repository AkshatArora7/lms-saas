import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ReportRunner } from "./runner.js";
import type { ReportStore } from "./store.js";

export interface ReportingRouteDeps {
  config: AppConfig;
  store: ReportStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
  runner: ReportRunner;
}

function resolveTenantOr400(
  deps: ReportingRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): TenantContext | null {
  try {
    return deps.resolveTenant(req);
  } catch {
    void reply
      .code(400)
      .send({ error: "tenant_required", message: "Missing tenant context." });
    return null;
  }
}

/** Trusted caller identity, stamped by the gateway as `x-user-id` (ADR-0027). */
function resolveUserId(req: FastifyRequest): string | null {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: "not_found", message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/**
 * Register the reporting surface: list definitions, create+execute a run
 * synchronously, and read runs. Mounted at root; the gateway strips the
 * `/api/reporting` prefix (proxy.ts) before forwarding.
 */
export function registerReportingRoutes(
  app: FastifyInstance,
  deps: ReportingRouteDeps,
): void {
  // List the caller-tenant's report definitions (built-ins seeded lazily).
  app.get("/definitions", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const definitions = await deps.store.listDefinitions(ctx);
    return reply.code(200).send({ definitions });
  });

  // Create a run, execute it synchronously via the injected runner, persist the
  // outcome, and return the run. Contract:
  //   - missing/blank definitionKey  -> 400 (no run persisted)
  //   - unknown definition key       -> 400 (no run persisted)
  //   - runner success               -> 201 with a status=succeeded run
  //   - runner execution failure     -> 200 with a persisted status=failed run
  app.post<{ Body: { definitionKey?: unknown; params?: unknown } }>(
    "/runs",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        definitionKey?: unknown;
        params?: unknown;
      };
      if (!isNonEmptyString(body.definitionKey)) {
        return badRequest(reply, "definitionKey is required.");
      }
      const definitionKey = body.definitionKey.trim();
      if (body.params !== undefined && !isPlainObject(body.params)) {
        return badRequest(reply, "params must be an object.");
      }
      const params = isPlainObject(body.params) ? body.params : {};

      const definition = await deps.store.getDefinitionByKey(ctx, definitionKey);
      if (!definition) {
        return badRequest(
          reply,
          `Unknown report definition '${definitionKey}'.`,
        );
      }
      const requestedBy = resolveUserId(req);

      try {
        const { result, rowCount } = await deps.runner.run(
          ctx,
          definitionKey,
          params,
        );
        const run = await deps.store.createRun(ctx, {
          definitionId: definition.id,
          definitionKey,
          requestedBy,
          status: "succeeded",
          params,
          result,
          rowCount,
          error: null,
          completedAt: new Date().toISOString(),
        });
        return reply.code(201).send({ run });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Report execution failed.";
        const run = await deps.store.createRun(ctx, {
          definitionId: definition.id,
          definitionKey,
          requestedBy,
          status: "failed",
          params,
          result: null,
          rowCount: null,
          error: message,
          completedAt: new Date().toISOString(),
        });
        return reply.code(200).send({ run });
      }
    },
  );

  // List the caller-tenant's runs, newest-first.
  app.get("/runs", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const runs = await deps.store.listRuns(ctx);
    return reply.code(200).send({ runs });
  });

  // Fetch a single run (incl. its result jsonb) by id.
  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const run = await deps.store.getRun(ctx, req.params.id);
    if (!run) return notFound(reply, "Run not found.");
    return reply.code(200).send({ run });
  });
}
