import { randomUUID } from "node:crypto";

import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { blobKey, validateUpload, type BlobSigner } from "./blob.js";
import { parseManifest } from "./scorm/manifest.js";
import { normalizeCmi, type RawCmi } from "./scorm/runtime.js";
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

  // --- SCORM import & runtime (#31) --------------------------------------
  // Import: parse the (already-extracted) imsmanifest.xml and store a launchable
  // package. Unzip + asset byte-serving is a documented follow-up; the manifest
  // XML is supplied in the request body alongside the uploaded .zip blob URL.
  app.post("/scorm/packages", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      manifestXml?: unknown;
      topicId?: unknown;
      blobUrl?: unknown;
    };
    if (!isNonEmptyString(body.manifestXml)) {
      return badRequest(reply, "manifestXml is required.");
    }
    if (!isNonEmptyString(body.blobUrl)) {
      return badRequest(reply, "blobUrl is required.");
    }
    if (body.topicId !== undefined && !isNonEmptyString(body.topicId)) {
      return badRequest(reply, "topicId must be a non-empty string.");
    }
    const parsed = parseManifest(body.manifestXml);
    if (!parsed.ok) {
      // Map the parser reasons to a stable error code per the route contract.
      const error =
        parsed.reason === "unsafe_href"
          ? "unsafe_href"
          : parsed.reason === "no_launchable_resource"
            ? "no_launchable_resource"
            : "invalid_manifest";
      return reply.code(400).send({ error, message: parsed.message });
    }
    const m = parsed.manifest;
    const pkg = await deps.store.createScormPackage(ctx, {
      blobUrl: body.blobUrl.trim(),
      version: m.version,
      title: m.organizationTitle,
      launchHref: m.launchHref,
      masteryScore: m.masteryScore,
      manifest: m as unknown as Record<string, unknown>,
      ...(isNonEmptyString(body.topicId) ? { topicId: body.topicId.trim() } : {}),
    });
    return reply.code(201).send({ package: pkg });
  });

  app.get<{ Params: { id: string } }>(
    "/scorm/packages/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const pkg = await deps.store.getScormPackage(ctx, req.params.id);
      if (!pkg) return notFound(reply, "SCORM package not found.");
      return reply.code(200).send({ package: pkg });
    },
  );

  app.put<{ Params: { id: string } }>(
    "/scorm/packages/:id/runtime",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        learnerId?: unknown;
        lessonStatus?: unknown;
        completionStatus?: unknown;
        successStatus?: unknown;
        scoreRaw?: unknown;
        scoreMax?: unknown;
        scoreScaled?: unknown;
        sessionTime?: unknown;
        totalTime?: unknown;
      };
      if (!isNonEmptyString(body.learnerId)) {
        return badRequest(reply, "learnerId is required.");
      }
      // Normalize the raw cmi fields (either SCORM 1.2 or 2004) before storing.
      const raw: RawCmi = {
        ...(typeof body.lessonStatus === "string"
          ? { lessonStatus: body.lessonStatus }
          : {}),
        ...(typeof body.completionStatus === "string"
          ? { completionStatus: body.completionStatus }
          : {}),
        ...(typeof body.successStatus === "string"
          ? { successStatus: body.successStatus }
          : {}),
        ...(typeof body.scoreRaw === "number" ? { scoreRaw: body.scoreRaw } : {}),
        ...(typeof body.scoreMax === "number" ? { scoreMax: body.scoreMax } : {}),
        ...(typeof body.scoreScaled === "number"
          ? { scoreScaled: body.scoreScaled }
          : {}),
        ...(typeof body.sessionTime === "string"
          ? { sessionTime: body.sessionTime }
          : {}),
        ...(typeof body.totalTime === "string"
          ? { totalTime: body.totalTime }
          : {}),
      };
      const n = normalizeCmi(raw);
      const result = await deps.store.saveScormAttempt(ctx, req.params.id, {
        learnerId: body.learnerId.trim(),
        completionStatus: n.completionStatus,
        successStatus: n.successStatus,
        scoreScaled: n.scoreScaled,
        scoreRaw: n.scoreRaw,
        lessonStatus: n.lessonStatus,
        sessionTime: n.sessionTime,
        totalTime: n.totalTime,
      });
      if (!result.ok) return notFound(reply, "SCORM package not found.");
      return reply.code(200).send({ attempt: result.attempt });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { learnerId?: string } }>(
    "/scorm/packages/:id/runtime",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const learnerId = req.query.learnerId;
      if (!isNonEmptyString(learnerId)) {
        return badRequest(reply, "learnerId query parameter is required.");
      }
      // The package must exist for this tenant; otherwise 404.
      const pkg = await deps.store.getScormPackage(ctx, req.params.id);
      if (!pkg) return notFound(reply, "SCORM package not found.");
      const attempt = await deps.store.getScormAttempt(
        ctx,
        req.params.id,
        learnerId.trim(),
      );
      return reply.code(200).send({ attempt });
    },
  );
}
