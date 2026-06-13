import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  AssessmentStore,
  GradingMethod,
  QuestionKind,
  ResponseInput,
} from "./store.js";

export interface AssessmentRouteDeps {
  config: AppConfig;
  store: AssessmentStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: AssessmentRouteDeps,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const QUESTION_KINDS: readonly QuestionKind[] = [
  "multiple_choice",
  "multi_select",
  "true_false",
  "short_answer",
  "essay",
  "matching",
  "ordering",
  "fill_blank",
  "numeric",
];

const GRADING_METHODS: readonly GradingMethod[] = [
  "highest",
  "latest",
  "average",
  "first",
];

/** Register the assessment domain surface: banks, quiz authoring, attempts. */
export function registerAssessmentRoutes(
  app: FastifyInstance,
  deps: AssessmentRouteDeps,
): void {
  // --- Question libraries (banks) -----------------------------------------
  app.post("/question-libraries", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    const library = await deps.store.createLibrary(ctx, {
      name: body.name.trim(),
      courseId: isNonEmptyString(body.courseId) ? body.courseId.trim() : null,
    });
    return reply.code(201).send({ library });
  });

  app.get("/question-libraries", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const libraries = await deps.store.listLibraries(ctx);
    return reply.code(200).send({ libraries });
  });

  app.post<{ Params: { id: string } }>(
    "/question-libraries/:id/questions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!QUESTION_KINDS.includes(body.kind as QuestionKind)) {
        return badRequest(
          reply,
          `kind must be one of ${QUESTION_KINDS.join(", ")}.`,
        );
      }
      if (!isNonEmptyString(body.stem)) {
        return badRequest(reply, "stem is required.");
      }
      if (body.points !== undefined && !isFiniteNumber(body.points)) {
        return badRequest(reply, "points must be a number.");
      }
      if (body.body !== undefined && !isPlainObject(body.body)) {
        return badRequest(reply, "body must be an object.");
      }
      const question = await deps.store.addQuestion(ctx, req.params.id, {
        kind: body.kind as QuestionKind,
        stem: body.stem.trim(),
        points: body.points as number | undefined,
        body: body.body as Record<string, unknown> | undefined,
        difficulty: isNonEmptyString(body.difficulty)
          ? body.difficulty.trim()
          : null,
      });
      return reply.code(201).send({ question });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/question-libraries/:id/questions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const questions = await deps.store.listQuestions(ctx, req.params.id);
      return reply.code(200).send({ questions });
    },
  );

  // --- Quiz authoring ------------------------------------------------------
  app.post("/quizzes", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isNonEmptyString(body.courseId)) {
      return badRequest(reply, "courseId is required.");
    }
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    if (
      body.gradingMethod !== undefined &&
      !GRADING_METHODS.includes(body.gradingMethod as GradingMethod)
    ) {
      return badRequest(
        reply,
        `gradingMethod must be one of ${GRADING_METHODS.join(", ")}.`,
      );
    }
    const quiz = await deps.store.createQuiz(ctx, {
      courseId: body.courseId.trim(),
      title: body.title.trim(),
      description: isNonEmptyString(body.description)
        ? body.description.trim()
        : null,
      attemptsAllowed: isFiniteNumber(body.attemptsAllowed)
        ? body.attemptsAllowed
        : null,
      timeLimitMinutes: isFiniteNumber(body.timeLimitMinutes)
        ? body.timeLimitMinutes
        : null,
      shuffle: body.shuffle === true,
      availableFrom: isNonEmptyString(body.availableFrom)
        ? body.availableFrom
        : null,
      availableUntil: isNonEmptyString(body.availableUntil)
        ? body.availableUntil
        : null,
      gradingMethod: body.gradingMethod as GradingMethod | undefined,
    });
    return reply.code(201).send({ quiz });
  });

  app.get<{ Params: { id: string } }>("/quizzes/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const assembled = await deps.store.getQuiz(ctx, req.params.id);
    if (!assembled) return notFound(reply, "Quiz not found.");
    return reply.code(200).send(assembled);
  });

  app.post<{ Params: { id: string } }>(
    "/quizzes/:id/publish",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const quiz = await deps.store.publishQuiz(ctx, req.params.id);
      if (!quiz) return notFound(reply, "Quiz not found.");
      return reply.code(200).send({ quiz });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/quizzes/:id/sections",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (body.drawCount !== undefined && !isFiniteNumber(body.drawCount)) {
        return badRequest(reply, "drawCount must be a number.");
      }
      const section = await deps.store.addSection(ctx, req.params.id, {
        title: isNonEmptyString(body.title) ? body.title.trim() : null,
        position: body.position as number | undefined,
        drawCount: isFiniteNumber(body.drawCount) ? body.drawCount : null,
      });
      if (!section) return notFound(reply, "Quiz not found.");
      return reply.code(201).send({ section });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sections/:id/questions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isNonEmptyString(body.questionId)) {
        return badRequest(reply, "questionId is required.");
      }
      if (body.points !== undefined && !isFiniteNumber(body.points)) {
        return badRequest(reply, "points must be a number.");
      }
      const quizQuestion = await deps.store.addQuizQuestion(ctx, req.params.id, {
        questionId: body.questionId.trim(),
        points: isFiniteNumber(body.points) ? body.points : null,
        position: body.position as number | undefined,
      });
      if (!quizQuestion) return notFound(reply, "Section not found.");
      return reply.code(201).send({ quizQuestion });
    },
  );

  // --- Attempts ------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/quizzes/:id/attempts",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isNonEmptyString(body.userId)) {
        return badRequest(reply, "userId is required.");
      }
      const result = await deps.store.startAttempt(
        ctx,
        req.params.id,
        body.userId.trim(),
      );
      if (!result.ok) {
        if (result.reason === "unknown_quiz") {
          return notFound(reply, "Quiz not found.");
        }
        return reply.code(409).send({
          error: result.reason,
          message: `Cannot start attempt: ${result.reason}.`,
        });
      }
      return reply.code(201).send({
        attempt: result.attempt,
        questions: result.questions,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/attempts/:id/submit",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { responses?: unknown };
      if (!Array.isArray(body.responses)) {
        return badRequest(reply, "responses must be an array.");
      }
      const responses: ResponseInput[] = [];
      for (const entry of body.responses) {
        if (!isPlainObject(entry) || !isNonEmptyString(entry.questionId)) {
          return badRequest(
            reply,
            "each response needs a questionId and response object.",
          );
        }
        responses.push({
          questionId: entry.questionId.trim(),
          response: isPlainObject(entry.response) ? entry.response : {},
        });
      }
      const result = await deps.store.submitAttempt(
        ctx,
        req.params.id,
        responses,
      );
      if (!result.ok) {
        if (result.reason === "unknown_attempt") {
          return notFound(reply, "Attempt not found.");
        }
        return reply.code(409).send({
          error: "already_submitted",
          message: "This attempt was already submitted.",
        });
      }
      return reply
        .code(200)
        .send({ attempt: result.attempt, responses: result.responses });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/attempts/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const attempt = await deps.store.getAttempt(ctx, req.params.id);
      if (!attempt) return notFound(reply, "Attempt not found.");
      return reply.code(200).send({ attempt });
    },
  );
}
