import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  AttendanceCategory,
  AttendanceStore,
  NewSessionInput,
  RecordInput,
} from "./store.js";

export interface AttendanceRouteDeps {
  config: AppConfig;
  store: AttendanceStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

const DEFAULT_CHRONIC_ABSENCE_THRESHOLD = 0.1;
const CATEGORIES: readonly AttendanceCategory[] = [
  "present",
  "absent",
  "tardy",
  "excused",
];

function resolveTenantOr400(
  deps: AttendanceRouteDeps,
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

function isAttendanceCategory(value: unknown): value is AttendanceCategory {
  return (
    typeof value === "string" &&
    (CATEGORIES as readonly string[]).includes(value)
  );
}

interface CodeBody {
  code?: unknown;
  label?: unknown;
  category?: unknown;
  isDefault?: unknown;
}

interface SessionBody {
  orgUnitId?: unknown;
  meetingDate?: unknown;
  periodLabel?: unknown;
  timetableEntryId?: unknown;
  takenBy?: unknown;
}

interface RecordsBody {
  records?: unknown;
}

function parseRecords(raw: unknown): RecordInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: RecordInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const r = item as Record<string, unknown>;
    if (!isNonEmptyString(r.userId) || !isNonEmptyString(r.code)) return null;
    out.push({
      userId: r.userId,
      code: r.code,
      minutesLate:
        typeof r.minutesLate === "number" ? r.minutesLate : null,
      comment: isNonEmptyString(r.comment) ? r.comment : null,
    });
  }
  return out;
}

/** Register the attendance domain surface: codes, sessions, records, summaries. */
export function registerAttendanceRoutes(
  app: FastifyInstance,
  deps: AttendanceRouteDeps,
): void {
  app.get("/codes", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const codes = await deps.store.listCodes(ctx);
    return reply.code(200).send({ codes });
  });

  app.post("/codes", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as CodeBody;
    if (!isNonEmptyString(body.code)) {
      return badRequest(reply, "code is required.");
    }
    if (!isNonEmptyString(body.label)) {
      return badRequest(reply, "label is required.");
    }
    if (!isAttendanceCategory(body.category)) {
      return badRequest(
        reply,
        "category must be one of present|absent|tardy|excused.",
      );
    }
    const code = await deps.store.upsertCode(ctx, {
      code: body.code.trim(),
      label: body.label.trim(),
      category: body.category,
      isDefault: body.isDefault === true,
    });
    return reply.code(201).send({ code });
  });

  app.post("/codes/seed-defaults", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const codes = await deps.store.seedDefaultCodes(ctx);
    return reply.code(200).send({ codes });
  });

  app.post("/sessions", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as SessionBody;
    if (!isNonEmptyString(body.orgUnitId)) {
      return badRequest(reply, "orgUnitId is required.");
    }
    if (!isNonEmptyString(body.meetingDate)) {
      return badRequest(reply, "meetingDate (YYYY-MM-DD) is required.");
    }
    const input: NewSessionInput = {
      orgUnitId: body.orgUnitId.trim(),
      meetingDate: body.meetingDate.trim(),
      periodLabel: isNonEmptyString(body.periodLabel)
        ? body.periodLabel.trim()
        : null,
      timetableEntryId: isNonEmptyString(body.timetableEntryId)
        ? body.timetableEntryId
        : null,
      takenBy: isNonEmptyString(body.takenBy) ? body.takenBy : null,
    };
    const result = await deps.store.createSession(ctx, input);
    if (!result.ok) {
      return reply.code(409).send({
        error: "session_exists",
        message: "An attendance session already exists for this meeting.",
      });
    }
    return reply.code(201).send({ session: result.session });
  });

  app.get<{ Params: { id: string } }>(
    "/sessions/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const found = await deps.store.getSession(ctx, req.params.id);
      if (!found) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Session not found." });
      }
      return reply.code(200).send(found);
    },
  );

  app.put<{ Params: { id: string } }>(
    "/sessions/:id/records",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const records = parseRecords((req.body as RecordsBody)?.records);
      if (!records) {
        return badRequest(
          reply,
          "records must be a non-empty array of { userId, code }.",
        );
      }
      const result = await deps.store.setRecords(ctx, req.params.id, records);
      if (!result.ok) {
        if (result.reason === "unknown_code") {
          return badRequest(
            reply,
            "One or more records reference an unknown attendance code.",
          );
        }
        return reply.code(409).send({
          error: "session_finalized",
          message: "Session not found or already finalized.",
        });
      }
      return reply.code(200).send({ records: result.records });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sessions/:id/finalize",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const session = await deps.store.finalizeSession(ctx, req.params.id);
      if (!session) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Session not found." });
      }
      return reply.code(200).send({ session });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { threshold?: string } }>(
    "/sections/:id/attendance/summary",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const raw = Number(req.query.threshold);
      const threshold =
        Number.isFinite(raw) && raw >= 0 && raw <= 1
          ? raw
          : DEFAULT_CHRONIC_ABSENCE_THRESHOLD;
      const summary = await deps.store.sectionSummary(
        ctx,
        req.params.id,
        threshold,
      );
      return reply.code(200).send({ summary });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/users/:id/attendance",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const history = await deps.store.userHistory(ctx, req.params.id);
      return reply.code(200).send({ history });
    },
  );
}
