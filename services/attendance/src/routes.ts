import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  canExportAttendance,
  toCsv,
  toOneRoster,
  type OneRosterIdMap,
} from "./export.js";
import type { GuardianChildrenResolver } from "./guardian-resolver.js";
import type {
  AttendanceCategory,
  AttendanceExportRow,
  AttendanceStore,
  NewSessionInput,
  ParticipationInput,
  RecordInput,
} from "./store.js";

/** Trusted caller identity, stamped by the gateway/BFF from verified claims. */
export interface Caller {
  userId: string;
  roles: string[];
}

export interface AttendanceRouteDeps {
  config: AppConfig;
  store: AttendanceStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
  /**
   * Resolve the authenticated caller from the trusted `x-user-id` header (#190).
   * Throws when `x-user-id` is absent so the guardian routes fail closed (401).
   */
  resolveCaller: (req: FastifyRequest) => Caller;
  /**
   * Authority for the set of children a guardian may currently read (active link
   * + satisfied consent), owned by user-org and consumed via this port (#190).
   */
  guardianResolver: GuardianChildrenResolver;
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

function resolveCallerOr401(
  deps: AttendanceRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): Caller | null {
  try {
    return deps.resolveCaller(req);
  } catch {
    void reply
      .code(401)
      .send({ error: "unauthorized", message: "Missing caller identity." });
    return null;
  }
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict calendar date (YYYY-MM-DD) — also rejects impossible dates. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
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

function isScore0to4(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 4
  );
}

/**
 * Validate a participation payload (#378). Mirrors `parseRecords`: non-empty
 * array; each item needs a non-empty-string `userId`; `score` (if present) is an
 * integer 0..4; `note` (if present) is a non-empty string; AT LEAST ONE of
 * score/note must be present — mirroring the DB CHECK so bad input fails at the
 * edge. Returns null on any violation (route maps to 400).
 */
function parseParticipation(raw: unknown): ParticipationInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ParticipationInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const r = item as Record<string, unknown>;
    if (!isNonEmptyString(r.userId)) return null;
    const hasScore = r.score !== undefined && r.score !== null;
    const hasNote = r.note !== undefined && r.note !== null;
    if (hasScore && !isScore0to4(r.score)) return null;
    if (hasNote && !isNonEmptyString(r.note)) return null;
    // At least one of score/note must be present (DB CHECK at the edge).
    const score = hasScore ? (r.score as number) : null;
    const note = isNonEmptyString(r.note) ? r.note.trim() : null;
    if (score === null && note === null) return null;
    out.push({ userId: r.userId, score, note });
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

  app.put<{ Params: { id: string } }>(
    "/sessions/:id/participation",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const records = parseParticipation((req.body as RecordsBody)?.records);
      if (!records) {
        return badRequest(
          reply,
          "records must be a non-empty array of { userId, score? (0-4 int), note? } " +
            "where at least one of score or note is present.",
        );
      }
      // recorded_by comes ONLY from the server-trusted caller (x-user-id), never
      // the request body. Tenant context alone authorizes the write (mirrors
      // PUT /records); a missing caller is allowed and stamps recorded_by=null.
      let recordedBy: string | null = null;
      try {
        recordedBy = deps.resolveCaller(req).userId;
      } catch {
        recordedBy = null;
      }
      const result = await deps.store.setParticipation(
        ctx,
        req.params.id,
        records,
        recordedBy,
      );
      if (!result.ok) {
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

  // --- Guardian-scoped attendance view (#190) ---------------------------------
  // The guardian is the AUTHENTICATED caller (trusted `x-user-id`), never a
  // client-supplied param. The resolver returns ONLY active + consented children
  // for this tenant; a studentId not in that set is denied (404) and no
  // attendance read is ever attempted for it (deny-by-default).

  // List the caller's authorized children (ids + relationship). Empty is valid.
  app.get("/guardian/children", async (req, reply) => {
    const caller = resolveCallerOr401(deps, req, reply);
    if (!caller) return reply;
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const children = await deps.guardianResolver.resolveChildren(
      ctx,
      caller.userId,
    );
    return reply.code(200).send({ children });
  });

  // A specific child's attendance history — only if that child is in the
  // caller's authorized set; otherwise 404 (deny-by-default, no existence probe).
  app.get<{ Params: { studentId: string } }>(
    "/guardian/children/:studentId/attendance",
    async (req, reply) => {
      const caller = resolveCallerOr401(deps, req, reply);
      if (!caller) return reply;
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.studentId)) {
        return badRequest(reply, "studentId must be a uuid.");
      }
      const children = await deps.guardianResolver.resolveChildren(
        ctx,
        caller.userId,
      );
      const authorized = children.some(
        (c) => c.studentUserId === req.params.studentId,
      );
      if (!authorized) {
        return reply.code(404).send({
          error: "not_found",
          message: "No attendance for this student.",
        });
      }
      const history = await deps.store.userHistory(ctx, req.params.studentId);
      return reply.code(200).send({ studentId: req.params.studentId, history });
    },
  );

  // --- Compliance / SIS export (#377) -----------------------------------------
  // GET /export?from=&to=&sectionId?=&format=csv|oneroster — admin/compliance
  // only. Caller is the trusted x-user-id/x-user-roles identity (401 if absent),
  // role-gated to admin/compliance (403). Every read runs inside withTenant so
  // RLS scopes the export to the caller's tenant (no cross-tenant leak). Only
  // ids/codes are emitted — no learner names/emails (PII minimization).
  app.get<{
    Querystring: {
      from?: string;
      to?: string;
      sectionId?: string;
      format?: string;
    };
  }>("/export", async (req, reply) => {
    const caller = resolveCallerOr401(deps, req, reply);
    if (!caller) return reply;
    if (!canExportAttendance(caller.roles)) {
      return reply.code(403).send({
        error: "forbidden",
        message: "Exporting attendance requires an admin or compliance role.",
      });
    }
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const { from, to, sectionId, format } = req.query;
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      return badRequest(reply, "from and to must be valid YYYY-MM-DD dates.");
    }
    if (from > to) {
      return badRequest(reply, "from must be on or before to.");
    }
    if (sectionId !== undefined && !UUID_RE.test(sectionId)) {
      return badRequest(reply, "sectionId must be a uuid.");
    }
    const fmt = format ?? "csv";
    if (fmt !== "csv" && fmt !== "oneroster") {
      return badRequest(reply, "format must be csv or oneroster.");
    }

    const rows = await deps.store.exportAttendance(ctx, {
      from,
      to,
      sectionId: sectionId ?? null,
    });

    if (fmt === "csv") {
      return reply
        .code(200)
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="attendance_${from}_${to}.csv"`,
        )
        .send(toCsv(rows));
    }

    // oneroster: resolve sourcedIds from sis_id_map (user + class), falling back
    // to the internal uuid in the formatter when a tenant is not SIS-synced.
    const idMap = await buildOneRosterIdMap(deps, ctx, rows);
    return reply
      .code(200)
      .header("content-type", "application/json")
      .send(toOneRoster(rows, idMap));
  });
}

/** Resolve user/class sourcedId maps from `sis_id_map` for the export rows (#377). */
async function buildOneRosterIdMap(
  deps: AttendanceRouteDeps,
  ctx: TenantContext,
  rows: readonly AttendanceExportRow[],
): Promise<OneRosterIdMap> {
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const orgUnitIds = [...new Set(rows.map((r) => r.orgUnitId))];
  const entries = await deps.store.sisIdMap(
    ctx,
    ["user", "class"],
    [...userIds, ...orgUnitIds],
  );
  const user = new Map<string, string>();
  const klass = new Map<string, string>();
  for (const e of entries) {
    if (e.entityType === "user") user.set(e.internalId, e.sourceId);
    else klass.set(e.internalId, e.sourceId);
  }
  return { user, class: klass };
}
