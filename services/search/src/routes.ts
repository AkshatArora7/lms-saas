import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { IndexDocumentInput, SearchFilter, SearchStore } from "./store.js";

export interface SearchRouteDeps {
  store: SearchStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: SearchRouteDeps,
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

/** Normalize a repeatable query param into a clean string[] (or undefined). */
function toStringArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const arr = (Array.isArray(value) ? value : [value])
    .filter((v) => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return arr.length > 0 ? arr : undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === "number");
}

/** Register the search surface: index upsert/delete, full search, typeahead. */
export function registerSearchRoutes(
  app: FastifyInstance,
  deps: SearchRouteDeps,
): void {
  // Idempotent upsert of one document into the tenant's search index.
  app.put("/search/documents", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      entityType?: unknown;
      entityId?: unknown;
      title?: unknown;
      body?: unknown;
      orgUnitId?: unknown;
      embedding?: unknown;
    };
    if (!isNonEmptyString(body.entityType)) {
      return badRequest(reply, "entityType is required.");
    }
    if (!isNonEmptyString(body.entityId)) {
      return badRequest(reply, "entityId is required.");
    }
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    if (body.body !== undefined && body.body !== null && typeof body.body !== "string") {
      return badRequest(reply, "body must be a string.");
    }
    if (
      body.orgUnitId !== undefined &&
      body.orgUnitId !== null &&
      !isNonEmptyString(body.orgUnitId)
    ) {
      return badRequest(reply, "orgUnitId must be a non-empty string.");
    }
    if (body.embedding !== undefined && body.embedding !== null && !isNumberArray(body.embedding)) {
      return badRequest(reply, "embedding must be an array of numbers.");
    }
    const input: IndexDocumentInput = {
      entityType: body.entityType.trim(),
      entityId: body.entityId.trim(),
      title: body.title.trim(),
      ...(typeof body.body === "string" ? { body: body.body } : {}),
      ...(isNonEmptyString(body.orgUnitId) ? { orgUnitId: body.orgUnitId.trim() } : {}),
      ...(isNumberArray(body.embedding) ? { embedding: body.embedding } : {}),
    };
    const document = await deps.store.indexDocument(ctx, input);
    return reply.code(200).send({ document });
  });

  // Remove one document from the index.
  app.delete<{ Params: { entityType: string; entityId: string } }>(
    "/search/documents/:entityType/:entityId",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      await deps.store.deleteDocument(
        ctx,
        req.params.entityType,
        req.params.entityId,
      );
      return reply.code(204).send();
    },
  );

  // Full search: keyword (+ optional semantic) ranking, permission-filtered.
  app.get<{
    Querystring: {
      q?: string;
      entityType?: string | string[];
      orgUnit?: string | string[];
      limit?: string;
    };
  }>("/search", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const q = req.query.q;
    if (!isNonEmptyString(q)) return badRequest(reply, "q is required.");
    const filter: SearchFilter = {
      ...(toStringArray(req.query.entityType)
        ? { entityTypes: toStringArray(req.query.entityType) }
        : {}),
      ...(toStringArray(req.query.orgUnit)
        ? { allowedOrgUnitIds: toStringArray(req.query.orgUnit) }
        : {}),
      ...(parseLimit(req.query.limit) !== undefined
        ? { limit: parseLimit(req.query.limit) }
        : {}),
    };
    const results = await deps.store.search(ctx, q.trim(), filter);
    return reply.code(200).send({ results });
  });

  // Fast typeahead: title-only, keyword-only, default limit 10.
  app.get<{
    Querystring: { q?: string; orgUnit?: string | string[]; limit?: string };
  }>("/search/typeahead", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const q = req.query.q;
    if (!isNonEmptyString(q)) return badRequest(reply, "q is required.");
    const filter: SearchFilter = {
      ...(toStringArray(req.query.orgUnit)
        ? { allowedOrgUnitIds: toStringArray(req.query.orgUnit) }
        : {}),
      ...(parseLimit(req.query.limit) !== undefined
        ? { limit: parseLimit(req.query.limit) }
        : {}),
    };
    const results = await deps.store.typeahead(ctx, q.trim(), filter);
    return reply.code(200).send({ results });
  });
}
