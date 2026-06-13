import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  NewBellScheduleInput,
  NewSchedulePeriodInput,
  NewTimetableEntryInput,
  SchedulingStore,
} from "./store.js";

export interface SchedulingRouteDeps {
  config: AppConfig;
  store: SchedulingStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: SchedulingRouteDeps,
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

interface CreateScheduleBody {
  orgUnitId?: unknown;
  name?: unknown;
  timezone?: unknown;
  isDefault?: unknown;
  periods?: unknown;
}

function parsePeriods(raw: unknown): NewSchedulePeriodInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const periods: NewSchedulePeriodInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const p = item as Record<string, unknown>;
    if (
      !isNonEmptyString(p.name) ||
      !isNonEmptyString(p.startTime) ||
      !isNonEmptyString(p.endTime)
    ) {
      return null;
    }
    periods.push({
      name: p.name.trim(),
      startTime: p.startTime,
      endTime: p.endTime,
      sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : undefined,
      dayPattern: isNonEmptyString(p.dayPattern) ? p.dayPattern : undefined,
    });
  }
  return periods;
}

interface CreateTimetableBody {
  orgUnitId?: unknown;
  periodId?: unknown;
  academicSessionId?: unknown;
  instructorId?: unknown;
  room?: unknown;
  dayOfWeek?: unknown;
}

/** Register the calendar service's class-scheduling surface. */
export function registerSchedulingRoutes(
  app: FastifyInstance,
  deps: SchedulingRouteDeps,
): void {
  app.get("/schedules", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const orgUnitId = (req.query as { orgUnitId?: string } | undefined)
      ?.orgUnitId;
    const schedules = await deps.store.listBellSchedules(ctx, orgUnitId);
    return reply.code(200).send({ schedules });
  });

  app.get<{ Params: { id: string } }>(
    "/schedules/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const schedule = await deps.store.getBellSchedule(ctx, req.params.id);
      if (!schedule) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Bell schedule not found." });
      }
      return reply.code(200).send({ schedule });
    },
  );

  app.post("/schedules", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as CreateScheduleBody;
    if (!isNonEmptyString(body.orgUnitId)) {
      return badRequest(reply, "orgUnitId is required.");
    }
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    const periods = parsePeriods(body.periods);
    if (!periods) {
      return badRequest(
        reply,
        "periods must be a non-empty array of { name, startTime, endTime }.",
      );
    }

    const input: NewBellScheduleInput = {
      orgUnitId: body.orgUnitId.trim(),
      name: body.name.trim(),
      timezone: isNonEmptyString(body.timezone) ? body.timezone : undefined,
      isDefault: body.isDefault === true,
      periods,
    };
    const schedule = await deps.store.createBellSchedule(ctx, input);
    return reply.code(201).send({ schedule });
  });

  app.post("/timetable", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as CreateTimetableBody;
    if (!isNonEmptyString(body.orgUnitId)) {
      return badRequest(reply, "orgUnitId is required.");
    }
    if (!isNonEmptyString(body.periodId)) {
      return badRequest(reply, "periodId is required.");
    }
    let dayOfWeek: number | null = null;
    if (body.dayOfWeek !== undefined && body.dayOfWeek !== null) {
      if (
        typeof body.dayOfWeek !== "number" ||
        !Number.isInteger(body.dayOfWeek) ||
        body.dayOfWeek < 0 ||
        body.dayOfWeek > 6
      ) {
        return badRequest(reply, "dayOfWeek must be an integer 0-6.");
      }
      dayOfWeek = body.dayOfWeek;
    }

    const input: NewTimetableEntryInput = {
      orgUnitId: body.orgUnitId.trim(),
      periodId: body.periodId.trim(),
      academicSessionId: isNonEmptyString(body.academicSessionId)
        ? body.academicSessionId
        : null,
      instructorId: isNonEmptyString(body.instructorId)
        ? body.instructorId
        : null,
      room: isNonEmptyString(body.room) ? body.room.trim() : null,
      dayOfWeek,
    };

    const result = await deps.store.createTimetableEntry(ctx, input);
    if (!result.ok) {
      return reply.code(409).send({
        error: "timetable_conflict",
        conflict: result.conflict,
        message: `A ${result.conflict} conflict prevents scheduling this entry.`,
      });
    }
    return reply.code(201).send({ entry: result.entry });
  });

  app.get<{ Params: { id: string } }>(
    "/users/:id/timetable",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const entries = await deps.store.listTimetableForInstructor(
        ctx,
        req.params.id,
      );
      return reply.code(200).send({ entries });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/org-units/:id/timetable",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const entries = await deps.store.listTimetableForOrgUnit(
        ctx,
        req.params.id,
      );
      return reply.code(200).send({ entries });
    },
  );
}
