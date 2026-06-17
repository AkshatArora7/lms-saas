import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  AnnotationStore,
  UpdateAnnotationInput,
} from "./annotations.js";

export interface AnnotationRouteDeps {
  store: AnnotationStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: AnnotationRouteDeps,
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
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: "not_found", message });
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Register the inline-feedback surface: annotations + feedback release. */
export function registerAnnotationRoutes(
  app: FastifyInstance,
  deps: AnnotationRouteDeps,
): void {
  app.post<{ Params: { id: string } }>(
    "/submissions/:id/annotations",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        body?: unknown;
        anchor?: unknown;
        authorId?: unknown;
      };
      if (!isNonEmptyString(body.body)) {
        return badRequest(reply, "body is required.");
      }
      if (body.anchor !== undefined && !isObject(body.anchor)) {
        return badRequest(reply, "anchor must be an object.");
      }
      const result = await deps.store.createAnnotation(ctx, req.params.id, {
        body: body.body.trim(),
        ...(isObject(body.anchor) ? { anchor: body.anchor } : {}),
        ...(isNonEmptyString(body.authorId) ? { authorId: body.authorId.trim() } : {}),
      });
      if (!result.ok) return notFound(reply, "Submission not found.");
      return reply.code(201).send({ annotation: result.annotation });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { released?: string } }>(
    "/submissions/:id/annotations",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const annotations = await deps.store.listAnnotations(ctx, req.params.id, {
        releasedOnly: req.query.released === "true",
      });
      return reply.code(200).send({ annotations });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/annotations/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { body?: unknown; anchor?: unknown };
      const patch: UpdateAnnotationInput = {};
      if (body.body !== undefined) {
        if (!isNonEmptyString(body.body)) {
          return badRequest(reply, "body must be a non-empty string.");
        }
        patch.body = body.body.trim();
      }
      if (body.anchor !== undefined) {
        if (!isObject(body.anchor)) {
          return badRequest(reply, "anchor must be an object.");
        }
        patch.anchor = body.anchor;
      }
      const annotation = await deps.store.updateAnnotation(ctx, req.params.id, patch);
      if (!annotation) return notFound(reply, "Annotation not found.");
      return reply.code(200).send({ annotation });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/annotations/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const removed = await deps.store.deleteAnnotation(ctx, req.params.id);
      if (!removed) return notFound(reply, "Annotation not found.");
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/submissions/:id/feedback/release",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const result = await deps.store.releaseFeedback(ctx, req.params.id);
      if (!result.ok) return notFound(reply, "Submission not found.");
      return reply
        .code(200)
        .send({ released: result.released, recipientId: result.recipientId });
    },
  );
}
