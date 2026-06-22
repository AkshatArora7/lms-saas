import { randomUUID } from "node:crypto";

import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { blobKey, validateUpload, type BlobSigner } from "./blob.js";
import {
  TOPIC_KINDS,
  type ContentStore,
  type TopicKind,
} from "./store.js";

export interface ContentRouteDeps {
  config: AppConfig;
  store: ContentStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
  blobSigner: BlobSigner;
  /** Max upload size in bytes (per-plan tiering is a follow-up). */
  maxUploadBytes?: number;
}

function resolveTenantOr400(
  deps: ContentRouteDeps,
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
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isTopicKind(value: unknown): value is TopicKind {
  return (
    typeof value === "string" && (TOPIC_KINDS as readonly string[]).includes(value)
  );
}
function optString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

/** Register the content surface: uploads, modules, topics, release conditions. */
export function registerContentRoutes(
  app: FastifyInstance,
  deps: ContentRouteDeps,
): void {
  // --- Uploads (#30) -----------------------------------------------------
  app.post("/uploads", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      filename?: unknown;
      contentType?: unknown;
      sizeBytes?: unknown;
    };
    if (!isNonEmptyString(body.filename)) {
      return badRequest(reply, "filename is required.");
    }
    if (!isNonEmptyString(body.contentType)) {
      return badRequest(reply, "contentType is required.");
    }
    if (typeof body.sizeBytes !== "number") {
      return badRequest(reply, "sizeBytes (number) is required.");
    }
    const check = validateUpload(
      body.contentType,
      body.sizeBytes,
      deps.maxUploadBytes,
    );
    if (!check.ok) {
      return reply.code(check.reason === "too_large" ? 413 : 415).send({
        error: check.reason,
        message: check.message,
      });
    }
    // Tenant-namespaced key = storage isolation boundary.
    const key = blobKey(ctx.tenantId, randomUUID(), body.filename);
    const signed = deps.blobSigner.sign(key, body.contentType);
    return reply.code(201).send({ upload: signed });
  });

  // --- Modules (#27) -----------------------------------------------------
  app.post<{ Params: { courseId: string } }>(
    "/courses/:courseId/modules",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        title?: unknown;
        parentId?: unknown;
        position?: unknown;
      };
      if (!isNonEmptyString(body.title)) {
        return badRequest(reply, "title is required.");
      }
      const module = await deps.store.createModule(ctx, req.params.courseId, {
        title: body.title.trim(),
        ...(isNonEmptyString(body.parentId) ? { parentId: body.parentId.trim() } : {}),
        ...(typeof body.position === "number" ? { position: body.position } : {}),
      });
      return reply.code(201).send({ module });
    },
  );

  app.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/modules",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const modules = await deps.store.listModules(ctx, req.params.courseId);
      return reply.code(200).send({ modules });
    },
  );

  app.get<{ Params: { id: string } }>("/modules/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const module = await deps.store.getModule(ctx, req.params.id);
    if (!module) return notFound(reply, "Module not found.");
    return reply.code(200).send({ module });
  });

  app.patch<{ Params: { id: string } }>("/modules/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as { title?: unknown; position?: unknown };
    const patch: { title?: string; position?: number } = {};
    if (body.title !== undefined) {
      if (!isNonEmptyString(body.title)) {
        return badRequest(reply, "title must be a non-empty string.");
      }
      patch.title = body.title.trim();
    }
    if (body.position !== undefined) {
      if (typeof body.position !== "number") {
        return badRequest(reply, "position must be a number.");
      }
      patch.position = body.position;
    }
    const module = await deps.store.updateModule(ctx, req.params.id, patch);
    if (!module) return notFound(reply, "Module not found.");
    return reply.code(200).send({ module });
  });

  app.delete<{ Params: { id: string } }>("/modules/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const removed = await deps.store.deleteModule(ctx, req.params.id);
    if (!removed) return notFound(reply, "Module not found.");
    return reply.code(204).send();
  });

  // --- Topics (#27 / #30) ------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/modules/:id/topics",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        title?: unknown;
        kind?: unknown;
        body?: unknown;
        blobUrl?: unknown;
        position?: unknown;
        isRequired?: unknown;
      };
      if (!isNonEmptyString(body.title)) {
        return badRequest(reply, "title is required.");
      }
      if (body.kind !== undefined && !isTopicKind(body.kind)) {
        return badRequest(reply, `kind must be one of: ${TOPIC_KINDS.join(", ")}.`);
      }
      const result = await deps.store.createTopic(ctx, req.params.id, {
        title: body.title.trim(),
        ...(isTopicKind(body.kind) ? { kind: body.kind } : {}),
        ...(optString(body.body) !== undefined ? { body: optString(body.body) } : {}),
        ...(optString(body.blobUrl) !== undefined
          ? { blobUrl: optString(body.blobUrl) }
          : {}),
        ...(typeof body.position === "number" ? { position: body.position } : {}),
        ...(typeof body.isRequired === "boolean"
          ? { isRequired: body.isRequired }
          : {}),
      });
      if (!result.ok) return notFound(reply, "Module not found.");
      return reply.code(201).send({ topic: result.topic });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/modules/:id/topics",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const topics = await deps.store.listTopics(ctx, req.params.id);
      return reply.code(200).send({ topics });
    },
  );

  app.patch<{ Params: { id: string } }>("/topics/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      title?: unknown;
      body?: unknown;
      blobUrl?: unknown;
      position?: unknown;
      isRequired?: unknown;
    };
    const patch: {
      title?: string;
      body?: string | null;
      blobUrl?: string | null;
      position?: number;
      isRequired?: boolean;
    } = {};
    if (body.title !== undefined) {
      if (!isNonEmptyString(body.title)) {
        return badRequest(reply, "title must be a non-empty string.");
      }
      patch.title = body.title.trim();
    }
    if (body.body !== undefined) patch.body = optString(body.body) ?? null;
    if (body.blobUrl !== undefined) patch.blobUrl = optString(body.blobUrl) ?? null;
    if (body.position !== undefined) {
      if (typeof body.position !== "number") {
        return badRequest(reply, "position must be a number.");
      }
      patch.position = body.position;
    }
    if (body.isRequired !== undefined) {
      if (typeof body.isRequired !== "boolean") {
        return badRequest(reply, "isRequired must be a boolean.");
      }
      patch.isRequired = body.isRequired;
    }
    const topic = await deps.store.updateTopic(ctx, req.params.id, patch);
    if (!topic) return notFound(reply, "Topic not found.");
    return reply.code(200).send({ topic });
  });

  app.delete<{ Params: { id: string } }>("/topics/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const removed = await deps.store.deleteTopic(ctx, req.params.id);
    if (!removed) return notFound(reply, "Topic not found.");
    return reply.code(204).send();
  });

  // --- Release conditions (#27 availability/prerequisites) ---------------
  app.post<{ Params: { courseId: string } }>(
    "/courses/:courseId/release-conditions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        targetType?: unknown;
        targetId?: unknown;
        expression?: unknown;
      };
      if (!isNonEmptyString(body.targetType)) {
        return badRequest(reply, "targetType is required.");
      }
      if (!isNonEmptyString(body.targetId)) {
        return badRequest(reply, "targetId is required.");
      }
      if (
        typeof body.expression !== "object" ||
        body.expression === null ||
        Array.isArray(body.expression)
      ) {
        return badRequest(reply, "expression must be an object (boolean tree).");
      }
      const condition = await deps.store.createReleaseCondition(
        ctx,
        req.params.courseId,
        {
          targetType: body.targetType.trim(),
          targetId: body.targetId.trim(),
          expression: body.expression as Record<string, unknown>,
        },
      );
      return reply.code(201).send({ condition });
    },
  );

  app.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/release-conditions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const conditions = await deps.store.listReleaseConditions(
        ctx,
        req.params.courseId,
      );
      return reply.code(200).send({ conditions });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/release-conditions/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const removed = await deps.store.deleteReleaseCondition(ctx, req.params.id);
      if (!removed) return notFound(reply, "Release condition not found.");
      return reply.code(204).send();
    },
  );

  // --- Rich pages (#32) --------------------------------------------------
  app.post<{ Params: { courseId: string } }>(
    "/courses/:courseId/pages",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        title?: unknown;
        slug?: unknown;
        body?: unknown;
      };
      if (!isNonEmptyString(body.title)) {
        return badRequest(reply, "title is required.");
      }
      if (body.slug !== undefined && !isNonEmptyString(body.slug)) {
        return badRequest(reply, "slug must be a non-empty string.");
      }
      if (body.body !== undefined && typeof body.body !== "string") {
        return badRequest(reply, "body must be a string.");
      }
      const page = await deps.store.createPage(ctx, req.params.courseId, {
        title: body.title.trim(),
        ...(isNonEmptyString(body.slug) ? { slug: body.slug.trim() } : {}),
        ...(typeof body.body === "string" ? { body: body.body } : {}),
      });
      return reply.code(201).send({ page });
    },
  );

  app.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/pages",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const pages = await deps.store.listPages(ctx, req.params.courseId);
      return reply.code(200).send({ pages });
    },
  );

  app.get<{ Params: { id: string } }>("/pages/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const page = await deps.store.getPage(ctx, req.params.id);
    if (!page) return notFound(reply, "Page not found.");
    return reply.code(200).send({ page });
  });

  app.patch<{ Params: { id: string } }>("/pages/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      title?: unknown;
      slug?: unknown;
      body?: unknown;
    };
    const patch: { title?: string; slug?: string; body?: string } = {};
    if (body.title !== undefined) {
      if (!isNonEmptyString(body.title)) {
        return badRequest(reply, "title must be a non-empty string.");
      }
      patch.title = body.title.trim();
    }
    if (body.slug !== undefined) {
      if (!isNonEmptyString(body.slug)) {
        return badRequest(reply, "slug must be a non-empty string.");
      }
      patch.slug = body.slug.trim();
    }
    if (body.body !== undefined) {
      if (typeof body.body !== "string") {
        return badRequest(reply, "body must be a string.");
      }
      patch.body = body.body;
    }
    const page = await deps.store.updatePage(ctx, req.params.id, patch);
    if (!page) return notFound(reply, "Page not found.");
    return reply.code(200).send({ page });
  });

  app.post<{ Params: { id: string } }>(
    "/pages/:id/publish",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { versionId?: unknown };
      if (body.versionId !== undefined && !isNonEmptyString(body.versionId)) {
        return badRequest(reply, "versionId must be a non-empty string.");
      }
      const page = await deps.store.publishPage(
        ctx,
        req.params.id,
        isNonEmptyString(body.versionId) ? body.versionId.trim() : undefined,
      );
      if (!page) {
        return notFound(reply, "Page or publishable version not found.");
      }
      return reply.code(200).send({ page });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/pages/:id/versions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const versions = await deps.store.listPageVersions(ctx, req.params.id);
      return reply.code(200).send({ versions });
    },
  );

  app.get<{ Params: { id: string; versionId: string } }>(
    "/pages/:id/versions/:versionId",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const version = await deps.store.getPageVersion(
        ctx,
        req.params.id,
        req.params.versionId,
      );
      if (!version) return notFound(reply, "Page version not found.");
      return reply.code(200).send({ version });
    },
  );
}
