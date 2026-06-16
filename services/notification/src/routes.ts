import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  CHANNELS,
  categoryForEvent,
  planDeliveries,
  type Channel,
  type NotificationStore,
  type PreferenceInput,
  type PreferenceRecord,
  type QuietHours,
} from "./store.js";

export interface NotificationRouteDeps {
  config: AppConfig;
  store: NotificationStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: NotificationRouteDeps,
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

function isChannel(value: unknown): value is Channel {
  return (
    typeof value === "string" && (CHANNELS as readonly string[]).includes(value)
  );
}

function parsePreferences(value: unknown): PreferenceInput[] | null {
  if (!Array.isArray(value)) return null;
  const prefs: PreferenceInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const { channel, category, isEnabled } = raw as Record<string, unknown>;
    if (!isChannel(channel)) return null;
    if (!isNonEmptyString(category)) return null;
    if (typeof isEnabled !== "boolean") return null;
    prefs.push({ channel, category: category.trim(), isEnabled });
  }
  return prefs;
}

function parseQuietHours(value: unknown): QuietHours | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { startHour, endHour } = value as Record<string, unknown>;
  if (typeof startHour !== "number" || typeof endHour !== "number") {
    return undefined;
  }
  return { startHour, endHour };
}

/** Register the notification surface: inbox, preferences, digest, fan-out. */
export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: NotificationRouteDeps,
): void {
  // --- In-app inbox --------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { unread?: string } }>(
    "/users/:id/notifications",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const inbox = await deps.store.listInbox(ctx, req.params.id, {
        unreadOnly: req.query.unread === "true",
      });
      return reply.code(200).send(inbox);
    },
  );

  app.post<{ Params: { id: string; nid: string } }>(
    "/users/:id/notifications/:nid/read",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const updated = await deps.store.markRead(
        ctx,
        req.params.id,
        req.params.nid,
      );
      if (!updated) return notFound(reply, "Notification not found.");
      return reply.code(200).send({ notification: updated });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/users/:id/notifications/read-all",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const updated = await deps.store.markAllRead(ctx, req.params.id);
      return reply.code(200).send({ updated });
    },
  );

  // --- Preferences ---------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/users/:id/preferences",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const preferences = await deps.store.getPreferences(ctx, req.params.id);
      return reply.code(200).send({ preferences });
    },
  );

  app.put<{ Params: { id: string }; Body: { preferences?: unknown } }>(
    "/users/:id/preferences",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { preferences?: unknown };
      const prefs = parsePreferences(body.preferences);
      if (!prefs) {
        return badRequest(
          reply,
          "preferences must be an array of {channel, category, isEnabled}.",
        );
      }
      const preferences = await deps.store.setPreferences(
        ctx,
        req.params.id,
        prefs,
      );
      return reply.code(200).send({ preferences });
    },
  );

  // --- Digest --------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/users/:id/digest/flush",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const flushed = await deps.store.flushDigest(ctx, req.params.id);
      return reply.code(200).send({ flushed });
    },
  );

  // --- Fan-out ingest ------------------------------------------------------
  // Consumes a domain event and writes one notification per recipient per
  // enabled channel, honouring per-user preferences and quiet hours.
  app.post("/events", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // The relay forwards the event id so the claim-and-apply can dedupe. Accept
    // it as `message_id`, falling back to the envelope's `id` field.
    const messageId = isNonEmptyString(body.message_id)
      ? body.message_id.trim()
      : isNonEmptyString(body.id)
        ? body.id.trim()
        : null;
    if (!messageId) {
      return badRequest(reply, "message_id (the event id) is required.");
    }

    if (!isNonEmptyString(body.type) && !isNonEmptyString(body.category)) {
      return badRequest(reply, "type or category is required.");
    }
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    if (
      !Array.isArray(body.recipientIds) ||
      body.recipientIds.some((r) => !isNonEmptyString(r))
    ) {
      return badRequest(reply, "recipientIds must be a non-empty string array.");
    }
    const recipientIds = (body.recipientIds as string[]).map((r) => r.trim());
    const category = isNonEmptyString(body.category)
      ? body.category.trim()
      : categoryForEvent((body.type as string).trim());

    const prefsByUser = new Map<string, PreferenceRecord[]>();
    for (const userId of new Set(recipientIds)) {
      prefsByUser.set(userId, await deps.store.getPreferences(ctx, userId));
    }

    const rows = planDeliveries({
      category,
      title: body.title.trim(),
      body: isNonEmptyString(body.body) ? body.body.trim() : null,
      data:
        body.data && typeof body.data === "object"
          ? (body.data as Record<string, unknown>)
          : {},
      recipientIds,
      prefsByUser,
      quietHours: parseQuietHours(body.quietHours),
    });

    // Claim-and-apply atomically: a redelivery of the same event id is a no-op
    // (deduped) but still succeeds, so the relay stamps published_at and never
    // retries forever.
    const { claimed, notifications } = await deps.store.ingestEvent(
      ctx,
      messageId,
      rows,
    );
    return reply.code(claimed ? 201 : 200).send({
      category,
      created: notifications.length,
      deduped: !claimed,
      notifications,
    });
  });
}
