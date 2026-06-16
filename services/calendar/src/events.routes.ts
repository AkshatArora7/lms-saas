import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { CalendarEventStore, EventFilter } from "./events.js";
import { toICalendar } from "./ical.js";

export interface CalendarEventRouteDeps {
  store: CalendarEventStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
  /** Clock for the iCal DTSTAMP (injectable for deterministic tests). */
  now?: () => Date;
}

function resolveTenantOr400(
  deps: CalendarEventRouteDeps,
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
function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}
function optIso(reply: FastifyReply, value: unknown, field: string): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isIsoDate(value)) {
    badRequest(reply, `${field} must be an ISO date-time.`);
    return false;
  }
  return value;
}

function filterFromQuery(q: {
  orgUnitId?: string;
  from?: string;
  to?: string;
}): EventFilter {
  return {
    ...(q.orgUnitId ? { orgUnitId: q.orgUnitId } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
  };
}

/** Register the calendar-event surface: events CRUD, source sync, iCal feed. */
export function registerCalendarEventRoutes(
  app: FastifyInstance,
  deps: CalendarEventRouteDeps,
): void {
  const now = deps.now ?? (() => new Date());

  app.post("/calendar/events", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      orgUnitId?: unknown;
      title?: unknown;
      description?: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      allDay?: unknown;
    };
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    if (!isIsoDate(body.startsAt)) {
      return badRequest(reply, "startsAt must be an ISO date-time.");
    }
    const endsAt = optIso(reply, body.endsAt, "endsAt");
    if (endsAt === false) return reply;
    const event = await deps.store.createEvent(ctx, {
      title: body.title.trim(),
      startsAt: body.startsAt,
      ...(isNonEmptyString(body.orgUnitId) ? { orgUnitId: body.orgUnitId.trim() } : {}),
      ...(isNonEmptyString(body.description)
        ? { description: body.description.trim() }
        : {}),
      ...(endsAt !== undefined ? { endsAt } : {}),
      ...(typeof body.allDay === "boolean" ? { allDay: body.allDay } : {}),
    });
    return reply.code(201).send({ event });
  });

  app.put("/calendar/events/source", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      sourceType?: unknown;
      sourceId?: unknown;
      orgUnitId?: unknown;
      title?: unknown;
      description?: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      allDay?: unknown;
    };
    if (body.sourceType !== "assignment" && body.sourceType !== "quiz") {
      return badRequest(reply, "sourceType must be 'assignment' or 'quiz'.");
    }
    if (!isNonEmptyString(body.sourceId)) {
      return badRequest(reply, "sourceId is required.");
    }
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    if (!isIsoDate(body.startsAt)) {
      return badRequest(reply, "startsAt must be an ISO date-time.");
    }
    const endsAt = optIso(reply, body.endsAt, "endsAt");
    if (endsAt === false) return reply;
    const event = await deps.store.syncSourceEvent(ctx, {
      sourceType: body.sourceType,
      sourceId: body.sourceId.trim(),
      title: body.title.trim(),
      startsAt: body.startsAt,
      ...(isNonEmptyString(body.orgUnitId) ? { orgUnitId: body.orgUnitId.trim() } : {}),
      ...(isNonEmptyString(body.description)
        ? { description: body.description.trim() }
        : {}),
      ...(endsAt !== undefined ? { endsAt } : {}),
      ...(typeof body.allDay === "boolean" ? { allDay: body.allDay } : {}),
    });
    return reply.code(200).send({ event });
  });

  app.get<{ Querystring: { orgUnitId?: string; from?: string; to?: string } }>(
    "/calendar/events",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const events = await deps.store.listEvents(ctx, filterFromQuery(req.query));
      return reply.code(200).send({ events });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/calendar/events/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const event = await deps.store.getEvent(ctx, req.params.id);
      if (!event) {
        return reply.code(404).send({ error: "not_found", message: "Event not found." });
      }
      return reply.code(200).send({ event });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/calendar/events/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const removed = await deps.store.deleteEvent(ctx, req.params.id);
      if (!removed) {
        return reply.code(404).send({ error: "not_found", message: "Event not found." });
      }
      return reply.code(204).send();
    },
  );

  // iCal subscription feed (timezone-correct, UTC). Subscribe in any calendar app.
  app.get<{ Querystring: { orgUnitId?: string; from?: string; to?: string } }>(
    "/calendar/feed.ics",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const events = await deps.store.listEvents(ctx, filterFromQuery(req.query));
      const stamp =
        `${now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
      const body = toICalendar(events, { calName: "LMS Calendar", stamp });
      return reply
        .code(200)
        .header("content-type", "text/calendar; charset=utf-8")
        .header("content-disposition", 'inline; filename="calendar.ics"')
        .send(body);
    },
  );
}
