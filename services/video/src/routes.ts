import { randomUUID } from "node:crypto";

import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { videoBlobKey, validateUpload, type BlobSigner } from "./blob.js";
import type { CourseAccessPolicy } from "./access.js";
import type { Captioner } from "./captioner.js";
import type { PipelineRunner } from "./pipeline.js";
import {
  parseCaptionTracks,
  type VideoRecord,
  type VideoStore,
} from "./store.js";
import type { Transcoder } from "./transcoder.js";

/** Tenant-wide admin persona (ADR-0027 trusted roles). */
export const SUPER_ADMIN_ROLE = "super_admin";
/** Org-scoped admin persona. */
export const ORG_ADMIN_ROLE = "org_admin";
/** Admin personas that may write any tenant video. */
export const ADMIN_ROLES = [SUPER_ADMIN_ROLE, ORG_ADMIN_ROLE] as const;
/**
 * Roles allowed to upload/create videos: tenant/org admins plus the teaching
 * personas the gateway stamps in `x-user-roles`.
 */
export const VIDEO_UPLOADER_ROLES = [
  SUPER_ADMIN_ROLE,
  ORG_ADMIN_ROLE,
  "instructor",
  "teacher",
  "teaching_assistant",
] as const;

/** Trusted caller identity, stamped by the gateway/BFF from verified claims. */
export interface Caller {
  userId: string;
  roles: string[];
}

export interface VideoRouteDeps {
  config: AppConfig;
  store: VideoStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
  /**
   * Resolve the authenticated caller from the trusted `x-user-id` /
   * `x-user-roles` headers (ADR-0027). Throws when `x-user-id` is absent so
   * write guards fail closed with 401.
   */
  resolveCaller: (req: FastifyRequest) => Caller;
  blobSigner: BlobSigner;
  /**
   * Course-scoped read gate (#319, ADR-0031): decides whether a caller may
   * read/stream a video associated with a `course_id`. Runs under the same
   * tenant RLS connection (or an offline Fake in tests).
   */
  courseAccessPolicy: CourseAccessPolicy;
  transcoder: Transcoder;
  captioner: Captioner;
  pipeline: PipelineRunner;
  /** Max upload size in bytes (per-plan tiering is a follow-up). */
  maxUploadBytes?: number;
}

function resolveTenantOr400(
  deps: VideoRouteDeps,
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

function resolveCallerOr401(
  deps: VideoRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): Caller | null {
  try {
    return deps.resolveCaller(req);
  } catch {
    void reply.code(401).send({
      error: "user_required",
      message: "Missing authenticated user.",
    });
    return null;
  }
}

function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ error: "forbidden", message });
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
function hasAnyRole(caller: Caller, roles: readonly string[]): boolean {
  return caller.roles.some((r) => roles.includes(r));
}
function isAdmin(caller: Caller): boolean {
  return hasAnyRole(caller, ADMIN_ROLES);
}

/** Shape a stored asset for the wire (the playback contract). */
function toResponse(video: VideoRecord): Record<string, unknown> {
  return {
    id: video.id,
    title: video.title,
    sourceBlobUrl: video.sourceBlobUrl,
    ownerId: video.ownerId,
    status: video.status,
    renditions: video.renditions,
    captions: video.captions,
    durationSeconds: video.durationSeconds,
    courseId: video.courseId,
    createdAt: video.createdAt,
  };
}

/**
 * Register the video surface: signed uploads, asset CRUD, the transcode
 * pipeline trigger, and manual caption edits. Reads are tenant-member by
 * default (RLS the access boundary); videos carrying a `course_id` are further
 * gated to enrolled/teaching/admin callers (#319). Writes require an uploader
 * role (create/upload) or owner/admin (transcode/captions).
 */
export function registerVideoRoutes(
  app: FastifyInstance,
  deps: VideoRouteDeps,
): void {
  // --- Signed upload (AC: per-tenant storage) ----------------------------
  app.post("/uploads", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const caller = resolveCallerOr401(deps, req, reply);
    if (!caller) return reply;
    if (!hasAnyRole(caller, VIDEO_UPLOADER_ROLES)) {
      return forbidden(reply, "You are not allowed to upload videos.");
    }
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
    const key = videoBlobKey(ctx.tenantId, randomUUID(), body.filename);
    const signed = deps.blobSigner.sign(key, body.contentType);
    return reply.code(201).send({ upload: signed });
  });

  // --- Create asset + enqueue pipeline (AC: async transcode) -------------
  app.post("/videos", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const caller = resolveCallerOr401(deps, req, reply);
    if (!caller) return reply;
    if (!hasAnyRole(caller, VIDEO_UPLOADER_ROLES)) {
      return forbidden(reply, "You are not allowed to create videos.");
    }
    const body = (req.body ?? {}) as {
      title?: unknown;
      sourceBlobUrl?: unknown;
      courseId?: unknown;
    };
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    if (!isNonEmptyString(body.sourceBlobUrl)) {
      return badRequest(reply, "sourceBlobUrl is required.");
    }
    if (body.courseId !== undefined && !isNonEmptyString(body.courseId)) {
      return badRequest(reply, "courseId must be a non-empty string when set.");
    }
    const video = await deps.store.createVideo(ctx, {
      title: body.title.trim(),
      sourceBlobUrl: body.sourceBlobUrl.trim(),
      ownerId: caller.userId,
      courseId: isNonEmptyString(body.courseId) ? body.courseId.trim() : null,
    });
    // Kick off transcode→caption. The default runner is fire-and-forget; the
    // injected sync runner (tests) awaits so the asset is already `ready`.
    await deps.pipeline.run(ctx, video.id);
    const current = (await deps.store.getVideo(ctx, video.id)) ?? video;
    return reply.code(201).send({ video: toResponse(current) });
  });

  // --- List / read (tenant member; course-scoped videos gated) -----------
  app.get("/videos", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const caller = resolveCallerOr401(deps, req, reply);
    if (!caller) return reply;
    // The store returns only videos this caller may read: null-course videos
    // for any member, plus course-scoped ones they are enrolled in / teach /
    // admin (DB-side filter — ADR-0031 §D).
    const videos = await deps.store.listVideos(ctx, caller);
    return reply.code(200).send({ videos: videos.map(toResponse) });
  });

  app.get<{ Params: { id: string } }>("/videos/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const video = await deps.store.getVideo(ctx, req.params.id);
    if (!video) return notFound(reply, "Video not found.");
    // Course-scoped videos (course_id set) are the playback authz surface:
    // require an authenticated caller, then the enrollment/teaching/admin gate.
    // Deny = 404 (existence-hiding, indistinguishable from cross-tenant/missing
    // — ADR-0031 §D), so a forbidden caller never receives the stream URLs.
    if (video.courseId !== null) {
      const caller = resolveCallerOr401(deps, req, reply);
      if (!caller) return reply;
      const allowed = await deps.courseAccessPolicy.canRead(
        ctx,
        video.courseId,
        caller,
      );
      if (!allowed) return notFound(reply, "Video not found.");
    }
    return reply.code(200).send({ video: toResponse(video) });
  });

  // --- (Re)run the transcode pipeline (owner or admin) -------------------
  app.post<{ Params: { id: string } }>(
    "/videos/:id/transcode",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const caller = resolveCallerOr401(deps, req, reply);
      if (!caller) return reply;
      const existing = await deps.store.getVideo(ctx, req.params.id);
      if (!existing) return notFound(reply, "Video not found.");
      if (existing.ownerId !== caller.userId && !isAdmin(caller)) {
        return forbidden(reply, "You are not allowed to transcode this video.");
      }
      await deps.pipeline.run(ctx, existing.id);
      const current = (await deps.store.getVideo(ctx, existing.id)) ?? existing;
      return reply.code(200).send({ video: toResponse(current) });
    },
  );

  // --- Manual caption edit (AC: manual edit; owner or admin) -------------
  app.patch<{ Params: { id: string } }>(
    "/videos/:id/captions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const caller = resolveCallerOr401(deps, req, reply);
      if (!caller) return reply;
      const existing = await deps.store.getVideo(ctx, req.params.id);
      if (!existing) return notFound(reply, "Video not found.");
      if (existing.ownerId !== caller.userId && !isAdmin(caller)) {
        return forbidden(reply, "You are not allowed to edit these captions.");
      }
      const body = (req.body ?? {}) as { captions?: unknown };
      const parsed = parseCaptionTracks(body.captions);
      if (!parsed.ok) return badRequest(reply, parsed.message);
      const updated = await deps.store.setCaptions(
        ctx,
        existing.id,
        parsed.captions,
      );
      if (!updated) return notFound(reply, "Video not found.");
      return reply.code(200).send({ video: toResponse(updated) });
    },
  );
}
