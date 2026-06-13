import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  statusOf,
  type AnnouncementRecord,
  type AnnouncementStore,
} from "./store.js";

export interface AnnouncementRouteDeps {
  config: AppConfig;
  store: AnnouncementStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: AnnouncementRouteDeps,
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

/** Validate an optional ISO-8601 datetime; returns false only when malformed. */
function isValidOptionalDate(value: unknown): value is string | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Decorate a record with its derived visibility status for responses. */
function withStatus(record: AnnouncementRecord, now: Date) {
  return { ...record, status: statusOf(record, now) };
}

/** Register the announcement surface: create/schedule, list, publish, expire. */
export function registerAnnouncementRoutes(
  app: FastifyInstance,
  deps: AnnouncementRouteDeps,
): void {
  app.post("/announcements", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isNonEmptyString(body.orgUnitId)) {
      return badRequest(reply, "orgUnitId is required.");
    }
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    if (!isNonEmptyString(body.body)) {
      return badRequest(reply, "body is required.");
    }
    if (!isValidOptionalDate(body.publishAt)) {
      return badRequest(reply, "publishAt must be an ISO-8601 datetime.");
    }
    if (!isValidOptionalDate(body.expiresAt)) {
      return badRequest(reply, "expiresAt must be an ISO-8601 datetime.");
    }
    const announcement = await deps.store.create(ctx, {
      orgUnitId: body.orgUnitId.trim(),
      authorId: isNonEmptyString(body.authorId) ? body.authorId.trim() : null,
      title: body.title.trim(),
      body: body.body.trim(),
      publishAt: isNonEmptyString(body.publishAt) ? body.publishAt : null,
      expiresAt: isNonEmptyString(body.expiresAt) ? body.expiresAt : null,
    });
    return reply
      .code(201)
      .send({ announcement: withStatus(announcement, new Date()) });
  });

  app.get<{ Params: { id: string } }>(
    "/announcements/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const announcement = await deps.store.get(ctx, req.params.id);
      if (!announcement) return notFound(reply, "Announcement not found.");
      return reply
        .code(200)
        .send({ announcement: withStatus(announcement, new Date()) });
    },
  );

  const listHandler = async (
    req: FastifyRequest<{
      Params: { id: string };
      Querystring: { include?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const now = new Date();
    const announcements = await deps.store.listForOrgUnit(ctx, req.params.id, {
      visibleOnly: req.query.include !== "all",
      now,
    });
    return reply
      .code(200)
      .send({ announcements: announcements.map((a) => withStatus(a, now)) });
  };

  // A course IS an org unit; expose both spellings for caller convenience.
  app.get("/courses/:id/announcements", listHandler);
  app.get("/org-units/:id/announcements", listHandler);

  app.patch<{ Params: { id: string } }>(
    "/announcements/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isValidOptionalDate(body.publishAt)) {
        return badRequest(reply, "publishAt must be an ISO-8601 datetime.");
      }
      if (!isValidOptionalDate(body.expiresAt)) {
        return badRequest(reply, "expiresAt must be an ISO-8601 datetime.");
      }
      const updated = await deps.store.update(ctx, req.params.id, {
        title: isNonEmptyString(body.title) ? body.title.trim() : undefined,
        body: isNonEmptyString(body.body) ? body.body.trim() : undefined,
        publishAt: isNonEmptyString(body.publishAt) ? body.publishAt : undefined,
        expiresAt:
          body.expiresAt === null
            ? null
            : isNonEmptyString(body.expiresAt)
              ? body.expiresAt
              : undefined,
      });
      if (!updated) return notFound(reply, "Announcement not found.");
      return reply
        .code(200)
        .send({ announcement: withStatus(updated, new Date()) });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/announcements/:id/publish",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const published = await deps.store.publishNow(ctx, req.params.id);
      if (!published) return notFound(reply, "Announcement not found.");
      return reply
        .code(200)
        .send({ announcement: withStatus(published, new Date()) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/announcements/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const removed = await deps.store.remove(ctx, req.params.id);
      if (!removed) return notFound(reply, "Announcement not found.");
      return reply.code(204).send();
    },
  );
}
