import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ALIGNMENT_TARGETS,
  RUBRIC_KINDS,
  type AlignmentTarget,
  type NewCriterionInput,
  type NewLevelInput,
  type RubricKind,
  type RubricStore,
  type ScoreSelection,
} from "./store.js";

export interface RubricRouteDeps {
  config: AppConfig;
  store: RubricStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: RubricRouteDeps,
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

function isRubricKind(value: unknown): value is RubricKind {
  return (
    typeof value === "string" && (RUBRIC_KINDS as readonly string[]).includes(value)
  );
}

function isAlignmentTarget(value: unknown): value is AlignmentTarget {
  return (
    typeof value === "string" &&
    (ALIGNMENT_TARGETS as readonly string[]).includes(value)
  );
}

/**
 * Parse and validate a criteria array. Returns the parsed criteria or an error
 * message string. Levels need a non-empty label and a finite numeric points.
 */
function parseCriteria(
  value: unknown,
): { ok: true; criteria: NewCriterionInput[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, criteria: [] };
  if (!Array.isArray(value)) {
    return { ok: false, message: "criteria must be an array." };
  }
  const criteria: NewCriterionInput[] = [];
  for (const raw of value) {
    const c = (raw ?? {}) as {
      name?: unknown;
      position?: unknown;
      levels?: unknown;
    };
    if (!isNonEmptyString(c.name)) {
      return { ok: false, message: "Each criterion needs a name." };
    }
    const levels: NewLevelInput[] = [];
    if (c.levels !== undefined) {
      if (!Array.isArray(c.levels)) {
        return { ok: false, message: "levels must be an array." };
      }
      for (const rawLvl of c.levels) {
        const l = (rawLvl ?? {}) as {
          label?: unknown;
          points?: unknown;
          descriptor?: unknown;
        };
        if (!isNonEmptyString(l.label)) {
          return { ok: false, message: "Each level needs a label." };
        }
        if (typeof l.points !== "number" || !Number.isFinite(l.points)) {
          return { ok: false, message: "Each level needs numeric points." };
        }
        levels.push({
          label: l.label.trim(),
          points: l.points,
          descriptor: isNonEmptyString(l.descriptor) ? l.descriptor.trim() : null,
        });
      }
    }
    criteria.push({
      name: c.name.trim(),
      ...(typeof c.position === "number" ? { position: c.position } : {}),
      levels,
    });
  }
  return { ok: true, criteria };
}

/** Register the rubric service surface: rubrics + competencies/outcomes. */
export function registerRubricRoutes(
  app: FastifyInstance,
  deps: RubricRouteDeps,
): void {
  // --- Rubrics (story #49) -----------------------------------------------
  app.post("/rubrics", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      name?: unknown;
      kind?: unknown;
      courseId?: unknown;
      criteria?: unknown;
    };
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    if (body.kind !== undefined && !isRubricKind(body.kind)) {
      return badRequest(reply, "kind must be analytic or holistic.");
    }
    const parsed = parseCriteria(body.criteria);
    if (!parsed.ok) return badRequest(reply, parsed.message);

    const rubric = await deps.store.createRubric(ctx, {
      name: body.name.trim(),
      ...(isRubricKind(body.kind) ? { kind: body.kind } : {}),
      ...(isNonEmptyString(body.courseId) ? { courseId: body.courseId.trim() } : {}),
      criteria: parsed.criteria,
    });
    return reply.code(201).send({ rubric });
  });

  app.get<{ Querystring: { courseId?: string } }>(
    "/rubrics",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const rubrics = await deps.store.listRubrics(ctx, req.query.courseId);
      return reply.code(200).send({ rubrics });
    },
  );

  app.get<{ Params: { id: string } }>("/rubrics/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const rubric = await deps.store.getRubric(ctx, req.params.id);
    if (!rubric) return notFound(reply, "Rubric not found.");
    return reply.code(200).send({ rubric });
  });

  app.post<{ Params: { id: string } }>(
    "/rubrics/:id/criteria",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const parsed = parseCriteria([req.body]);
      if (!parsed.ok) return badRequest(reply, parsed.message);
      const criterion = await deps.store.addCriterion(
        ctx,
        req.params.id,
        parsed.criteria[0]!,
      );
      if (!criterion) return notFound(reply, "Rubric not found.");
      return reply.code(201).send({ criterion });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/rubrics/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const removed = await deps.store.deleteRubric(ctx, req.params.id);
      if (!removed) return notFound(reply, "Rubric not found.");
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/rubrics/:id/score",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { selections?: unknown };
      if (!Array.isArray(body.selections)) {
        return badRequest(reply, "selections must be an array.");
      }
      const selections: ScoreSelection[] = [];
      for (const raw of body.selections) {
        const s = (raw ?? {}) as { criterionId?: unknown; levelId?: unknown };
        if (!isNonEmptyString(s.criterionId) || !isNonEmptyString(s.levelId)) {
          return badRequest(reply, "Each selection needs criterionId and levelId.");
        }
        selections.push({
          criterionId: s.criterionId.trim(),
          levelId: s.levelId.trim(),
        });
      }
      const result = await deps.store.scoreRubric(ctx, req.params.id, selections);
      if (!result.ok) {
        if (result.reason === "rubric_not_found") {
          return notFound(reply, result.message);
        }
        return badRequest(reply, result.message);
      }
      return reply.code(200).send({ score: result.score });
    },
  );

  // --- Competencies & outcomes (story #50) -------------------------------
  app.post("/competencies", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      name?: unknown;
      parentId?: unknown;
      description?: unknown;
    };
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    const result = await deps.store.createCompetency(ctx, {
      name: body.name.trim(),
      ...(isNonEmptyString(body.parentId) ? { parentId: body.parentId.trim() } : {}),
      ...(isNonEmptyString(body.description)
        ? { description: body.description.trim() }
        : {}),
    });
    if (!result.ok) {
      return badRequest(reply, "Parent competency not found for this tenant.");
    }
    return reply.code(201).send({ competency: result.competency });
  });

  app.get("/competencies", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const competencies = await deps.store.listCompetencies(ctx);
    return reply.code(200).send({ competencies });
  });

  app.post("/objectives", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      statement?: unknown;
      competencyId?: unknown;
      code?: unknown;
    };
    if (!isNonEmptyString(body.statement)) {
      return badRequest(reply, "statement is required.");
    }
    const result = await deps.store.createObjective(ctx, {
      statement: body.statement.trim(),
      ...(isNonEmptyString(body.competencyId)
        ? { competencyId: body.competencyId.trim() }
        : {}),
      ...(isNonEmptyString(body.code) ? { code: body.code.trim() } : {}),
    });
    if (!result.ok) {
      return badRequest(reply, "Competency not found for this tenant.");
    }
    return reply.code(201).send({ objective: result.objective });
  });

  app.get<{ Querystring: { competencyId?: string } }>(
    "/objectives",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const objectives = await deps.store.listObjectives(
        ctx,
        req.query.competencyId,
      );
      return reply.code(200).send({ objectives });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/objectives/:id/alignments",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        targetType?: unknown;
        targetId?: unknown;
      };
      if (!isAlignmentTarget(body.targetType)) {
        return badRequest(
          reply,
          `targetType must be one of: ${ALIGNMENT_TARGETS.join(", ")}.`,
        );
      }
      if (!isNonEmptyString(body.targetId)) {
        return badRequest(reply, "targetId is required.");
      }
      const result = await deps.store.alignObjective(ctx, req.params.id, {
        targetType: body.targetType,
        targetId: body.targetId.trim(),
      });
      if (!result.ok) return notFound(reply, "Objective not found.");
      return reply.code(201).send({ alignment: result.alignment });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/objectives/:id/alignments",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const alignments = await deps.store.listAlignmentsForObjective(
        ctx,
        req.params.id,
      );
      return reply.code(200).send({ alignments });
    },
  );

  app.get<{ Params: { targetType: string; targetId: string } }>(
    "/activities/:targetType/:targetId/objectives",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!isAlignmentTarget(req.params.targetType)) {
        return badRequest(reply, "Unknown target type.");
      }
      const objectives = await deps.store.listObjectivesForTarget(
        ctx,
        req.params.targetType,
        req.params.targetId,
      );
      return reply.code(200).send({ objectives });
    },
  );
}
