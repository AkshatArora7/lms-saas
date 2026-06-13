import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  computeFinalGrades,
  type GradeItemSource,
  type GradeSchemeRecord,
  type GradingStore,
  type SchemeRange,
} from "./store.js";

export interface GradingRouteDeps {
  config: AppConfig;
  store: GradingStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: GradingRouteDeps,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const SOURCE_TYPES: readonly GradeItemSource[] = ["quiz", "assignment", "manual"];

interface SchemeBody {
  name?: unknown;
  ranges?: unknown;
}

interface CategoryBody {
  name?: unknown;
  weight?: unknown;
  position?: unknown;
}

interface ItemBody {
  name?: unknown;
  maxPoints?: unknown;
  weight?: unknown;
  categoryId?: unknown;
  schemeId?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  position?: unknown;
}

interface GradeBody {
  points?: unknown;
  feedback?: unknown;
  isReleased?: unknown;
  gradedBy?: unknown;
}

function parseRanges(value: unknown): SchemeRange[] | null {
  if (!Array.isArray(value)) return null;
  const ranges: SchemeRange[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { symbol, min } = entry as { symbol?: unknown; min?: unknown };
    if (!isNonEmptyString(symbol) || !isFiniteNumber(min)) return null;
    ranges.push({ symbol: symbol.trim(), min });
  }
  return ranges;
}

/** Register the gradebook domain surface. */
export function registerGradingRoutes(
  app: FastifyInstance,
  deps: GradingRouteDeps,
): void {
  // --- Grade schemes -------------------------------------------------------
  app.post("/schemes", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as SchemeBody;
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    const ranges = parseRanges(body.ranges ?? []);
    if (ranges === null) {
      return badRequest(reply, "ranges must be a list of { symbol, min }.");
    }
    const scheme = await deps.store.createScheme(ctx, {
      name: body.name.trim(),
      ranges,
    });
    return reply.code(201).send({ scheme });
  });

  app.get("/schemes", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const schemes = await deps.store.listSchemes(ctx);
    return reply.code(200).send({ schemes });
  });

  // --- Categories ----------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/courses/:id/grade-categories",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as CategoryBody;
      if (!isNonEmptyString(body.name)) {
        return badRequest(reply, "name is required.");
      }
      if (body.weight !== undefined && !isFiniteNumber(body.weight)) {
        return badRequest(reply, "weight must be a number.");
      }
      const category = await deps.store.createCategory(ctx, req.params.id, {
        name: body.name.trim(),
        weight: body.weight as number | undefined,
        position: body.position as number | undefined,
      });
      return reply.code(201).send({ category });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/courses/:id/grade-categories",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const categories = await deps.store.listCategories(ctx, req.params.id);
      return reply.code(200).send({ categories });
    },
  );

  // --- Grade items (line items) -------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/courses/:id/grade-items",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as ItemBody;
      if (!isNonEmptyString(body.name)) {
        return badRequest(reply, "name is required.");
      }
      if (body.maxPoints !== undefined && !isFiniteNumber(body.maxPoints)) {
        return badRequest(reply, "maxPoints must be a number.");
      }
      if (body.weight !== undefined && !isFiniteNumber(body.weight)) {
        return badRequest(reply, "weight must be a number.");
      }
      if (
        body.sourceType !== undefined &&
        !SOURCE_TYPES.includes(body.sourceType as GradeItemSource)
      ) {
        return badRequest(
          reply,
          `sourceType must be one of ${SOURCE_TYPES.join(", ")}.`,
        );
      }
      const item = await deps.store.createItem(ctx, req.params.id, {
        name: body.name.trim(),
        maxPoints: body.maxPoints as number | undefined,
        weight: body.weight as number | undefined,
        categoryId: isNonEmptyString(body.categoryId)
          ? body.categoryId.trim()
          : undefined,
        schemeId: isNonEmptyString(body.schemeId)
          ? body.schemeId.trim()
          : undefined,
        sourceType: body.sourceType as GradeItemSource | undefined,
        sourceId: isNonEmptyString(body.sourceId)
          ? body.sourceId.trim()
          : undefined,
        position: body.position as number | undefined,
      });
      return reply.code(201).send({ item });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/courses/:id/grade-items",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const items = await deps.store.listItems(ctx, req.params.id);
      return reply.code(200).send({ items });
    },
  );

  // --- Enter / override a grade -------------------------------------------
  app.put<{ Params: { id: string; userId: string } }>(
    "/grade-items/:id/grades/:userId",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as GradeBody;
      if (
        body.points !== undefined &&
        body.points !== null &&
        !isFiniteNumber(body.points)
      ) {
        return badRequest(reply, "points must be a number or null.");
      }
      if (body.isReleased !== undefined && typeof body.isReleased !== "boolean") {
        return badRequest(reply, "isReleased must be a boolean.");
      }
      const result = await deps.store.upsertGrade(
        ctx,
        req.params.id,
        req.params.userId,
        {
          points: (body.points ?? null) as number | null,
          feedback: isNonEmptyString(body.feedback)
            ? body.feedback.trim()
            : null,
          isReleased: body.isReleased as boolean | undefined,
          gradedBy: isNonEmptyString(body.gradedBy)
            ? body.gradedBy.trim()
            : undefined,
        },
      );
      if (!result.ok) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Grade item not found." });
      }
      return reply.code(200).send({ grade: result.grade });
    },
  );

  // --- Bulk release --------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/courses/:id/grades/release",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const released = await deps.store.releaseCourseGrades(ctx, req.params.id);
      return reply.code(200).send({ released });
    },
  );

  // --- Full gradebook matrix ----------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/courses/:id/gradebook",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const gradebook = await deps.store.getGradebook(ctx, req.params.id);
      return reply.code(200).send({ gradebook });
    },
  );

  // --- Final-grade calculation --------------------------------------------
  app.post<{
    Params: { id: string };
    Querystring: { schemeId?: string };
  }>("/courses/:id/final-grades/calculate", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const gradebook = await deps.store.getGradebook(ctx, req.params.id);
    const schemeId = req.query.schemeId;
    let scheme: GradeSchemeRecord | undefined;
    if (isNonEmptyString(schemeId)) {
      const schemes = await deps.store.listSchemes(ctx);
      scheme = schemes.find((s) => s.id === schemeId);
    }
    const finalGrades = computeFinalGrades(gradebook, scheme);
    return reply.code(200).send({ finalGrades });
  });

  // --- Student grade view --------------------------------------------------
  app.get<{
    Params: { id: string; userId: string };
    Querystring: { schemeId?: string };
  }>("/courses/:id/students/:userId/grades", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const gradebook = await deps.store.getGradebook(ctx, req.params.id);
    // Students only see released grades.
    const releasedGrades = gradebook.grades.filter(
      (g) => g.userId === req.params.userId && g.isReleased,
    );
    const schemeId = req.query.schemeId;
    let scheme: GradeSchemeRecord | undefined;
    if (isNonEmptyString(schemeId)) {
      const schemes = await deps.store.listSchemes(ctx);
      scheme = schemes.find((s) => s.id === schemeId);
    }
    const projected = computeFinalGrades(
      { ...gradebook, grades: releasedGrades },
      scheme,
    ).find((f) => f.userId === req.params.userId) ?? {
      userId: req.params.userId,
      percent: 0,
      symbol: null,
      gradedItems: 0,
    };
    return reply.code(200).send({ grades: releasedGrades, projected });
  });

  // --- LTI AGS line items --------------------------------------------------
  app.get<{ Querystring: { courseId?: string } }>(
    "/lti/ags/lineitems",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const items = await deps.store.listLineItems(ctx, req.query.courseId);
      const lineItems = items.map((i) => ({
        id: i.id,
        label: i.name,
        scoreMaximum: i.maxPoints,
        resourceId: i.sourceId,
        tag: i.sourceType,
      }));
      return reply.code(200).send({ lineItems });
    },
  );
}
