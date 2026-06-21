import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { OneRosterClient } from "./oneroster.js";
import type { EntityType, SisStore } from "./store.js";
import { runSync } from "./sync.js";

export interface SisRouteDeps {
  client: OneRosterClient;
  store: SisStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: SisRouteDeps,
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

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

const ENTITY_TYPES: readonly EntityType[] = [
  "org",
  "user",
  "class",
  "course",
  "enrollment",
  "academicSession",
];

function isEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && (ENTITY_TYPES as readonly string[]).includes(value);
}

/** Register the SIS roster-sync surface (issue #14). */
export function registerSisRoutes(app: FastifyInstance, deps: SisRouteDeps): void {
  // Trigger a sync run. QStash cron calls this on a schedule (delta default).
  app.post("/sis/sync", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as { source?: unknown; full?: unknown; mode?: unknown };
    if (body.source !== undefined && body.source !== "oneroster_rest") {
      return badRequest(reply, "source must be 'oneroster_rest'.");
    }
    if (body.full !== undefined && typeof body.full !== "boolean") {
      return badRequest(reply, "full must be a boolean.");
    }
    if (body.mode !== undefined && body.mode !== "full" && body.mode !== "delta") {
      return badRequest(reply, "mode must be 'full' or 'delta'.");
    }
    const full = body.full === true || body.mode === "full";
    const run = await runSync(ctx, deps.client, deps.store, full ? { full: true } : {});
    return reply.code(201).send({ run });
  });

  // Run status + report.
  app.get<{ Params: { runId: string } }>("/sis/sync/:runId", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const run = await deps.store.getSyncRun(ctx, req.params.runId);
    if (!run) return reply.code(404).send({ error: "not_found" });
    return reply.code(200).send({ run });
  });

  // List recent runs (newest first).
  app.get<{ Querystring: { limit?: string } }>("/sis/sync", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const runs = await deps.store.listSyncRuns(
      ctx,
      limit && Number.isFinite(limit) ? { limit } : {},
    );
    return reply.code(200).send({ runs });
  });

  // id-map lookup / listing for admin debugging.
  app.get<{ Querystring: { entityType?: string; sourceId?: string } }>(
    "/sis/id-map",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const { entityType, sourceId } = req.query;
      if (entityType !== undefined && !isEntityType(entityType)) {
        return badRequest(
          reply,
          `entityType must be one of: ${ENTITY_TYPES.join(", ")}.`,
        );
      }
      if (sourceId) {
        if (!isEntityType(entityType)) {
          return badRequest(reply, "entityType is required when sourceId is given.");
        }
        const internalId = await deps.store.lookupInternalId(ctx, entityType, sourceId);
        if (internalId === null) return reply.code(404).send({ error: "not_found" });
        return reply.code(200).send({ mapping: { entityType, sourceId, internalId } });
      }
      const mappings = await deps.store.listIdMap(
        ctx,
        isEntityType(entityType) ? { entityType } : {},
      );
      return reply.code(200).send({ mappings });
    },
  );
}
