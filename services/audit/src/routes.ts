import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AuditStore, NewAuditInput } from "./store.js";

export interface AuditRouteDeps {
  config: AppConfig;
  store: AuditStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: AuditRouteDeps,
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

interface AuditBody {
  action?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  actorId?: unknown;
  metadata?: unknown;
  ipAddress?: unknown;
}

/** Register the audit surface: append an entry, list entries, verify the chain. */
export function registerAuditRoutes(
  app: FastifyInstance,
  deps: AuditRouteDeps,
): void {
  app.post("/audit/events", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as AuditBody;
    if (!isNonEmptyString(body.action)) {
      return badRequest(reply, "action is required.");
    }
    if (
      body.metadata !== undefined &&
      (typeof body.metadata !== "object" ||
        body.metadata === null ||
        Array.isArray(body.metadata))
    ) {
      return badRequest(reply, "metadata must be an object.");
    }
    const input: NewAuditInput = {
      action: body.action.trim(),
      ...(isNonEmptyString(body.targetType)
        ? { targetType: body.targetType.trim() }
        : {}),
      ...(isNonEmptyString(body.targetId) ? { targetId: body.targetId.trim() } : {}),
      ...(isNonEmptyString(body.actorId) ? { actorId: body.actorId.trim() } : {}),
      ...(body.metadata !== undefined
        ? { metadata: body.metadata as Record<string, unknown> }
        : {}),
      ...(isNonEmptyString(body.ipAddress)
        ? { ipAddress: body.ipAddress.trim() }
        : {}),
    };
    const entry = await deps.store.append(ctx, input);
    return reply.code(201).send({ entry });
  });

  app.get<{
    Querystring: { actorId?: string; targetType?: string; limit?: string };
  }>("/audit/events", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const { actorId, targetType, limit } = req.query;
    const parsedLimit = limit ? Number(limit) : undefined;
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      return badRequest(reply, "limit must be a number.");
    }
    const entries = await deps.store.list(ctx, {
      ...(actorId ? { actorId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    });
    return reply.code(200).send({ entries });
  });

  // Verification job: a scheduler (QStash/cron) hits this to detect tampering.
  app.get("/audit/verify", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const result = await deps.store.verify(ctx);
    // 200 with the result either way; ok=false flags a tampered chain.
    return reply.code(200).send({ result });
  });
}
