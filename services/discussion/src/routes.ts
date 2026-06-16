import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { DiscussionStore } from "./store.js";

export interface DiscussionRouteDeps {
  config: AppConfig;
  store: DiscussionStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: DiscussionRouteDeps,
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

/** Register the discussion domain surface: forums, topics, threaded posts. */
export function registerDiscussionRoutes(
  app: FastifyInstance,
  deps: DiscussionRouteDeps,
): void {
  // --- Forums --------------------------------------------------------------
  app.post("/forums", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isNonEmptyString(body.courseId)) {
      return badRequest(reply, "courseId is required.");
    }
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    const forum = await deps.store.createForum(ctx, {
      courseId: body.courseId.trim(),
      title: body.title.trim(),
      position:
        typeof body.position === "number" ? body.position : undefined,
    });
    return reply.code(201).send({ forum });
  });

  app.get<{ Querystring: { courseId?: string } }>(
    "/forums",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!isNonEmptyString(req.query.courseId)) {
        return badRequest(reply, "courseId query parameter is required.");
      }
      const forums = await deps.store.listForums(ctx, req.query.courseId.trim());
      return reply.code(200).send({ forums });
    },
  );

  // --- Topics --------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/forums/:id/topics",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isNonEmptyString(body.title)) {
        return badRequest(reply, "title is required.");
      }
      const topic = await deps.store.createTopic(ctx, req.params.id, {
        title: body.title.trim(),
        description: isNonEmptyString(body.description)
          ? body.description.trim()
          : null,
      });
      if (!topic) return notFound(reply, "Forum not found.");
      return reply.code(201).send({ topic });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/forums/:id/topics",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const topics = await deps.store.listTopics(ctx, req.params.id);
      return reply.code(200).send({ topics });
    },
  );

  // --- Posts ---------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/topics/:id/posts",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isNonEmptyString(body.authorId)) {
        return badRequest(reply, "authorId is required.");
      }
      if (!isNonEmptyString(body.body)) {
        return badRequest(reply, "body is required.");
      }
      const result = await deps.store.createPost(ctx, req.params.id, {
        authorId: body.authorId.trim(),
        body: body.body.trim(),
        parentId: isNonEmptyString(body.parentId) ? body.parentId.trim() : null,
      });
      if (!result.ok) {
        if (result.reason === "unknown_topic") {
          return notFound(reply, "Topic not found.");
        }
        return badRequest(reply, "Parent post not found in this topic.");
      }
      return reply.code(201).send({ post: result.post });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { view?: string } }>(
    "/topics/:id/posts",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (req.query.view === "thread") {
        const thread = await deps.store.getThread(ctx, req.params.id);
        return reply.code(200).send({ thread });
      }
      const posts = await deps.store.listPosts(ctx, req.params.id);
      return reply.code(200).send({ posts });
    },
  );

  // --- Moderation ----------------------------------------------------------
  app.patch<{ Params: { id: string }; Body: { body?: unknown } }>(
    "/posts/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { body?: unknown };
      if (!isNonEmptyString(body.body)) {
        return badRequest(reply, "body is required.");
      }
      const post = await deps.store.updatePost(
        ctx,
        req.params.id,
        body.body.trim(),
      );
      if (!post) return notFound(reply, "Post not found.");
      return reply.code(200).send({ post });
    },
  );

  app.post<{ Params: { id: string }; Body: { pinned?: unknown } }>(
    "/posts/:id/pin",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { pinned?: unknown };
      const pinned = body.pinned !== false; // default to pinning
      const post = await deps.store.setPinned(ctx, req.params.id, pinned);
      if (!post) return notFound(reply, "Post not found.");
      return reply.code(200).send({ post });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/posts/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const deleted = await deps.store.deletePost(ctx, req.params.id);
      if (!deleted) return notFound(reply, "Post not found.");
      return reply.code(204).send();
    },
  );

  // --- Graded participation -----------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/forums/:id/participation",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const participation = await deps.store.participation(ctx, req.params.id);
      return reply.code(200).send({ participation });
    },
  );
}
