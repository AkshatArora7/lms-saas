import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  AGGREGATE_DIMENSIONS,
  summarizeOrgUnitRollups,
  type AggregateDimension,
  type AnalyticsStore,
  type EventFilter,
} from "./store.js";

export interface AnalyticsRouteDeps {
  store: AnalyticsStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: AnalyticsRouteDeps,
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
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAggregateDimension(value: unknown): value is AggregateDimension {
  return (
    typeof value === "string" &&
    (AGGREGATE_DIMENSIONS as readonly string[]).includes(value)
  );
}

function filterFromQuery(q: {
  type?: string;
  action?: string;
  from?: string;
  to?: string;
}): EventFilter {
  return {
    ...(q.type ? { type: q.type } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
  };
}

/** Register the LRS surface: Caliper/xAPI ingestion, listing, de-id aggregates. */
export function registerAnalyticsRoutes(
  app: FastifyInstance,
  deps: AnalyticsRouteDeps,
): void {
  // Caliper event ingestion -> caliper_event + transactional outbox.
  app.post("/analytics/events", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      actorId?: unknown;
      type?: unknown;
      action?: unknown;
      objectType?: unknown;
      objectId?: unknown;
      orgUnitId?: unknown;
      eventTime?: unknown;
      envelope?: unknown;
    };
    if (!isNonEmptyString(body.type)) return badRequest(reply, "type is required.");
    if (!isNonEmptyString(body.action)) {
      return badRequest(reply, "action is required.");
    }
    if (!isNonEmptyString(body.objectType)) {
      return badRequest(reply, "objectType is required.");
    }
    if (!isNonEmptyString(body.objectId)) {
      return badRequest(reply, "objectId is required.");
    }
    if (body.eventTime !== undefined && !isNonEmptyString(body.eventTime)) {
      return badRequest(reply, "eventTime must be an ISO date-time.");
    }
    if (body.envelope !== undefined && !isObject(body.envelope)) {
      return badRequest(reply, "envelope must be an object.");
    }
    const event = await deps.store.recordCaliperEvent(ctx, {
      type: body.type.trim(),
      action: body.action.trim(),
      objectType: body.objectType.trim(),
      objectId: body.objectId.trim(),
      ...(isNonEmptyString(body.actorId) ? { actorId: body.actorId.trim() } : {}),
      ...(isNonEmptyString(body.orgUnitId)
        ? { orgUnitId: body.orgUnitId.trim() }
        : {}),
      ...(isNonEmptyString(body.eventTime) ? { eventTime: body.eventTime } : {}),
      ...(isObject(body.envelope) ? { envelope: body.envelope } : {}),
    });
    return reply.code(201).send({ event });
  });

  // xAPI statement ingestion -> xapi_statement.
  app.post("/analytics/xapi", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      actorId?: unknown;
      verb?: unknown;
      objectId?: unknown;
      result?: unknown;
    };
    if (!isNonEmptyString(body.verb)) return badRequest(reply, "verb is required.");
    if (!isNonEmptyString(body.objectId)) {
      return badRequest(reply, "objectId is required.");
    }
    if (body.result !== undefined && !isObject(body.result)) {
      return badRequest(reply, "result must be an object.");
    }
    const statement = await deps.store.recordXapiStatement(ctx, {
      verb: body.verb.trim(),
      objectId: body.objectId.trim(),
      ...(isNonEmptyString(body.actorId) ? { actorId: body.actorId.trim() } : {}),
      ...(isObject(body.result) ? { result: body.result } : {}),
    });
    return reply.code(201).send({ statement });
  });

  app.get<{
    Querystring: { type?: string; action?: string; from?: string; to?: string };
  }>("/analytics/events", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const events = await deps.store.listEvents(ctx, filterFromQuery(req.query));
    return reply.code(200).send({ events });
  });

  // De-identified aggregate (no actor identity) — safe to pool cross-tenant.
  app.get<{
    Querystring: {
      dimension?: string;
      type?: string;
      action?: string;
      from?: string;
      to?: string;
    };
  }>("/analytics/aggregate", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const dimension = req.query.dimension ?? "type";
    if (!isAggregateDimension(dimension)) {
      return badRequest(
        reply,
        `dimension must be one of: ${AGGREGATE_DIMENSIONS.join(", ")}.`,
      );
    }
    const aggregate = await deps.store.aggregate(
      ctx,
      dimension,
      filterFromQuery(req.query),
    );
    return reply.code(200).send({ aggregate });
  });

  // Per-"school" reporting rollups for the admin /reports screen (#269). A
  // tenant-scoped read across the existing domain tables (enrollment, course,
  // attendance, grade) via withTenant + RLS — analytics is the reporting
  // bounded context. Returns one row per `organization` org unit plus a
  // district-level summary.
  app.get("/reports/org-units", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const orgUnits = await deps.store.listOrgUnitRollups(ctx);
    return reply
      .code(200)
      .send({ orgUnits, summary: summarizeOrgUnitRollups(orgUnits) });
  });

  // Per-course engagement score + at-risk learners for the teacher `/teach`
  // insights (#277). Tenant-scoped via withTenant + RLS; computed LIVE over
  // enrollment/attendance/submission/grade (the engagement_summary CQRS table
  // has no writer — ADR-277). Teacher scoping is a BFF concern; the endpoint is
  // tenant-scoped only, like /reports/org-units. 400 on a missing/invalid
  // courseId.
  app.get<{ Querystring: { courseId?: string } }>(
    "/reports/engagement",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const { courseId } = req.query;
      if (!isUuid(courseId)) {
        return badRequest(reply, "courseId must be a valid uuid.");
      }
      const result = await deps.store.getCourseEngagement(ctx, courseId.trim());
      return reply.code(200).send(result);
    },
  );
}
