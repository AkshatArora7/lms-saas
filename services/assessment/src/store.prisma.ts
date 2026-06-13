import { withTenant } from "@lms/db";

import {
  gradeResponse,
  secureBody,
  type AddQuizQuestionInput,
  type AssembledQuiz,
  type AssessmentStore,
  type AttemptStatus,
  type DeliveredQuestion,
  type GradingMethod,
  type NewLibraryInput,
  type NewQuestionInput,
  type NewQuizInput,
  type NewSectionInput,
  type QuestionKind,
  type QuestionLibraryRecord,
  type QuestionRecord,
  type QuizAttemptRecord,
  type QuizQuestionRecord,
  type QuizRecord,
  type QuizResponseRecord,
  type QuizSectionRecord,
  type ResponseInput,
  type StartAttemptResult,
  type SubmitAttemptResult,
} from "./store.js";

type Json = Record<string, unknown>;

function asJson(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Json;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Json) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function num(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : Number(value);
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

interface LibraryRow {
  id: string;
  tenant_id: string;
  course_id: string | null;
  name: string;
}
interface QuestionRow {
  id: string;
  tenant_id: string;
  library_id: string | null;
  kind: QuestionKind;
  stem: string;
  points: number | string;
  body: unknown;
  difficulty: string | null;
  created_at: Date | string;
}
interface QuizRow {
  id: string;
  tenant_id: string;
  course_id: string;
  title: string;
  description: string | null;
  attempts_allowed: number | null;
  time_limit_minutes: number | null;
  shuffle: boolean;
  available_from: Date | string | null;
  available_until: Date | string | null;
  grading_method: GradingMethod;
  is_published: boolean;
  created_at: Date | string;
}
interface SectionRow {
  id: string;
  tenant_id: string;
  quiz_id: string;
  title: string | null;
  position: number;
  draw_count: number | null;
}
interface QuizQuestionRow {
  id: string;
  tenant_id: string;
  section_id: string;
  question_id: string;
  points: number | string | null;
  position: number;
}
interface AttemptRow {
  id: string;
  tenant_id: string;
  quiz_id: string;
  user_id: string;
  attempt_no: number;
  status: AttemptStatus;
  score: number | string | null;
  max_score: number | string | null;
  started_at: Date | string;
  submitted_at: Date | string | null;
  graded_at: Date | string | null;
}
interface ResponseRow {
  id: string;
  tenant_id: string;
  attempt_id: string;
  question_id: string;
  response: unknown;
  awarded: number | string | null;
  is_correct: boolean | null;
}

function toLibrary(r: LibraryRow): QuestionLibraryRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    courseId: r.course_id,
    name: r.name,
  };
}
function toQuestion(r: QuestionRow): QuestionRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    libraryId: r.library_id,
    kind: r.kind,
    stem: r.stem,
    points: num(r.points) ?? 0,
    body: asJson(r.body),
    difficulty: r.difficulty,
    createdAt: iso(r.created_at) ?? "",
  };
}
function toQuiz(r: QuizRow): QuizRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    courseId: r.course_id,
    title: r.title,
    description: r.description,
    attemptsAllowed: r.attempts_allowed,
    timeLimitMinutes: r.time_limit_minutes,
    shuffle: r.shuffle,
    availableFrom: iso(r.available_from),
    availableUntil: iso(r.available_until),
    gradingMethod: r.grading_method,
    isPublished: r.is_published,
    createdAt: iso(r.created_at) ?? "",
  };
}
function toSection(r: SectionRow): QuizSectionRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    quizId: r.quiz_id,
    title: r.title,
    position: r.position,
    drawCount: r.draw_count,
  };
}
function toQuizQuestion(r: QuizQuestionRow): QuizQuestionRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    sectionId: r.section_id,
    questionId: r.question_id,
    points: num(r.points),
    position: r.position,
  };
}
function toAttempt(r: AttemptRow): QuizAttemptRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    quizId: r.quiz_id,
    userId: r.user_id,
    attemptNo: r.attempt_no,
    status: r.status,
    score: num(r.score),
    maxScore: num(r.max_score),
    startedAt: iso(r.started_at) ?? "",
    submittedAt: iso(r.submitted_at),
    gradedAt: iso(r.graded_at),
  };
}
function toResponse(r: ResponseRow): QuizResponseRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    attemptId: r.attempt_id,
    questionId: r.question_id,
    response: asJson(r.response),
    awarded: num(r.awarded),
    isCorrect: r.is_correct,
  };
}

/**
 * Postgres-backed assessment store. Every call runs through `withTenant`, so
 * all statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database. Auto-grading reuses the pure `gradeResponse` helper.
 */
export function createPrismaStore(): AssessmentStore {
  return {
    async createLibrary(ctx, input: NewLibraryInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<LibraryRow[]>(
          `INSERT INTO question_library (tenant_id, course_id, name)
           VALUES ($1, $2, $3)
           RETURNING id, tenant_id, course_id, name`,
          ctx.tenantId,
          input.courseId ?? null,
          input.name,
        );
        return toLibrary(rows[0]!);
      });
    },

    async listLibraries(ctx) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<LibraryRow[]>(
          `SELECT id, tenant_id, course_id, name FROM question_library ORDER BY name`,
        );
        return rows.map(toLibrary);
      });
    },

    async addQuestion(ctx, libraryId, input: NewQuestionInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<QuestionRow[]>(
          `INSERT INTO question
             (tenant_id, library_id, kind, stem, points, body, difficulty)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
           RETURNING id, tenant_id, library_id, kind, stem, points, body,
                     difficulty, created_at`,
          ctx.tenantId,
          libraryId,
          input.kind,
          input.stem,
          input.points ?? 1,
          JSON.stringify(input.body ?? {}),
          input.difficulty ?? null,
        );
        return toQuestion(rows[0]!);
      });
    },

    async listQuestions(ctx, libraryId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<QuestionRow[]>(
          `SELECT id, tenant_id, library_id, kind, stem, points, body,
                  difficulty, created_at
             FROM question WHERE library_id = $1 ORDER BY created_at`,
          libraryId,
        );
        return rows.map(toQuestion);
      });
    },

    async createQuiz(ctx, input: NewQuizInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<QuizRow[]>(
          `INSERT INTO quiz
             (tenant_id, course_id, title, description, attempts_allowed,
              time_limit_minutes, shuffle, available_from, available_until,
              grading_method)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, tenant_id, course_id, title, description,
                     attempts_allowed, time_limit_minutes, shuffle,
                     available_from, available_until, grading_method,
                     is_published, created_at`,
          ctx.tenantId,
          input.courseId,
          input.title,
          input.description ?? null,
          input.attemptsAllowed ?? null,
          input.timeLimitMinutes ?? null,
          input.shuffle ?? false,
          input.availableFrom ?? null,
          input.availableUntil ?? null,
          input.gradingMethod ?? "highest",
        );
        return toQuiz(rows[0]!);
      });
    },

    async getQuiz(ctx, id): Promise<AssembledQuiz | null> {
      return withTenant(ctx, async (db) => {
        const quizRows = await db.$queryRawUnsafe<QuizRow[]>(
          `SELECT id, tenant_id, course_id, title, description,
                  attempts_allowed, time_limit_minutes, shuffle,
                  available_from, available_until, grading_method,
                  is_published, created_at
             FROM quiz WHERE id = $1 LIMIT 1`,
          id,
        );
        if (quizRows.length === 0) return null;
        const sectionRows = await db.$queryRawUnsafe<SectionRow[]>(
          `SELECT id, tenant_id, quiz_id, title, position, draw_count
             FROM quiz_section WHERE quiz_id = $1 ORDER BY position`,
          id,
        );
        const sections = [];
        for (const sRow of sectionRows) {
          const qqRows = await db.$queryRawUnsafe<
            (QuizQuestionRow & QuestionRow)[]
          >(
            `SELECT qq.id, qq.tenant_id, qq.section_id, qq.question_id,
                    qq.points, qq.position,
                    q.id AS q_id, q.kind, q.stem, q.points AS q_points,
                    q.body, q.difficulty, q.library_id, q.created_at
               FROM quiz_question qq
               JOIN question q ON q.id = qq.question_id
              WHERE qq.section_id = $1 ORDER BY qq.position`,
            sRow.id,
          );
          const questions = qqRows.map((r) => ({
            ...toQuizQuestion(r),
            question: toQuestion({
              id: (r as unknown as { q_id: string }).q_id,
              tenant_id: r.tenant_id,
              library_id: r.library_id,
              kind: r.kind,
              stem: r.stem,
              points: (r as unknown as { q_points: number | string }).q_points,
              body: r.body,
              difficulty: r.difficulty,
              created_at: r.created_at,
            }),
          }));
          sections.push({ section: toSection(sRow), questions });
        }
        return { quiz: toQuiz(quizRows[0]!), sections };
      });
    },

    async publishQuiz(ctx, id) {
      return withTenant(ctx, async (db) => {
        const updated = await db.$executeRawUnsafe(
          `UPDATE quiz SET is_published = true WHERE id = $1`,
          id,
        );
        if (updated === 0) return null;
        const rows = await db.$queryRawUnsafe<QuizRow[]>(
          `SELECT id, tenant_id, course_id, title, description,
                  attempts_allowed, time_limit_minutes, shuffle,
                  available_from, available_until, grading_method,
                  is_published, created_at
             FROM quiz WHERE id = $1 LIMIT 1`,
          id,
        );
        return rows[0] ? toQuiz(rows[0]) : null;
      });
    },

    async addSection(ctx, quizId, input: NewSectionInput) {
      return withTenant(ctx, async (db) => {
        const quizRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM quiz WHERE id = $1 LIMIT 1`,
          quizId,
        );
        if (quizRows.length === 0) return null;
        const rows = await db.$queryRawUnsafe<SectionRow[]>(
          `INSERT INTO quiz_section (tenant_id, quiz_id, title, position, draw_count)
           VALUES (
             $1, $2, $3,
             COALESCE($4, (SELECT COUNT(*)::int FROM quiz_section WHERE quiz_id = $2)),
             $5
           )
           RETURNING id, tenant_id, quiz_id, title, position, draw_count`,
          ctx.tenantId,
          quizId,
          input.title ?? null,
          input.position ?? null,
          input.drawCount ?? null,
        );
        return toSection(rows[0]!);
      });
    },

    async addQuizQuestion(ctx, sectionId, input: AddQuizQuestionInput) {
      return withTenant(ctx, async (db) => {
        const sectionRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM quiz_section WHERE id = $1 LIMIT 1`,
          sectionId,
        );
        if (sectionRows.length === 0) return null;
        const rows = await db.$queryRawUnsafe<QuizQuestionRow[]>(
          `INSERT INTO quiz_question (tenant_id, section_id, question_id, points, position)
           VALUES (
             $1, $2, $3, $4,
             COALESCE($5, (SELECT COUNT(*)::int FROM quiz_question WHERE section_id = $2))
           )
           RETURNING id, tenant_id, section_id, question_id, points, position`,
          ctx.tenantId,
          sectionId,
          input.questionId,
          input.points ?? null,
          input.position ?? null,
        );
        return toQuizQuestion(rows[0]!);
      });
    },

    async startAttempt(ctx, quizId, userId, now = new Date()) {
      return withTenant<StartAttemptResult>(ctx, async (db) => {
        const quizRows = await db.$queryRawUnsafe<QuizRow[]>(
          `SELECT id, tenant_id, course_id, title, description,
                  attempts_allowed, time_limit_minutes, shuffle,
                  available_from, available_until, grading_method,
                  is_published, created_at
             FROM quiz WHERE id = $1 LIMIT 1`,
          quizId,
        );
        const quiz = quizRows[0] ? toQuiz(quizRows[0]) : null;
        if (!quiz) return { ok: false, reason: "unknown_quiz" };
        if (!quiz.isPublished) return { ok: false, reason: "not_published" };
        if (quiz.availableFrom && now < new Date(quiz.availableFrom)) {
          return { ok: false, reason: "not_available" };
        }
        if (quiz.availableUntil && now > new Date(quiz.availableUntil)) {
          return { ok: false, reason: "not_available" };
        }
        const priorRows = await db.$queryRawUnsafe<{ count: number | string }[]>(
          `SELECT COUNT(*)::int AS count FROM quiz_attempt
            WHERE quiz_id = $1 AND user_id = $2`,
          quizId,
          userId,
        );
        const priorCount = Number(priorRows[0]?.count ?? 0);
        if (
          quiz.attemptsAllowed !== null &&
          priorCount >= quiz.attemptsAllowed
        ) {
          return { ok: false, reason: "no_attempts_left" };
        }

        const assembled = await this.getQuiz(ctx, quizId);
        const delivered: DeliveredQuestion[] = [];
        for (const { section, questions } of assembled!.sections) {
          const chosen =
            section.drawCount !== null && section.drawCount < questions.length
              ? questions.slice(0, section.drawCount)
              : questions;
          for (const qq of chosen) {
            delivered.push({
              questionId: qq.question.id,
              kind: qq.question.kind,
              stem: qq.question.stem,
              points: qq.points ?? qq.question.points,
              prompt: secureBody(qq.question.body),
            });
          }
        }

        const attemptRows = await db.$queryRawUnsafe<AttemptRow[]>(
          `INSERT INTO quiz_attempt
             (tenant_id, quiz_id, user_id, attempt_no, status, started_at)
           VALUES ($1, $2, $3, $4, 'in_progress', $5)
           RETURNING id, tenant_id, quiz_id, user_id, attempt_no, status,
                     score, max_score, started_at, submitted_at, graded_at`,
          ctx.tenantId,
          quizId,
          userId,
          priorCount + 1,
          now.toISOString(),
        );
        return {
          ok: true,
          attempt: toAttempt(attemptRows[0]!),
          questions: delivered,
        };
      });
    },

    async submitAttempt(ctx, attemptId, responses: ResponseInput[]) {
      return withTenant<SubmitAttemptResult>(ctx, async (db) => {
        const attemptRows = await db.$queryRawUnsafe<AttemptRow[]>(
          `SELECT id, tenant_id, quiz_id, user_id, attempt_no, status,
                  score, max_score, started_at, submitted_at, graded_at
             FROM quiz_attempt WHERE id = $1 LIMIT 1`,
          attemptId,
        );
        const attempt = attemptRows[0] ? toAttempt(attemptRows[0]) : null;
        if (!attempt) return { ok: false, reason: "unknown_attempt" };
        if (attempt.status !== "in_progress") {
          return { ok: false, reason: "already_submitted" };
        }

        let score = 0;
        let maxScore = 0;
        let anyManual = false;
        const stored: QuizResponseRecord[] = [];

        for (const input of responses) {
          const qRows = await db.$queryRawUnsafe<QuestionRow[]>(
            `SELECT id, tenant_id, library_id, kind, stem, points, body,
                    difficulty, created_at
               FROM question WHERE id = $1 LIMIT 1`,
            input.questionId,
          );
          if (qRows.length === 0) continue;
          const question = toQuestion(qRows[0]!);
          const ppRows = await db.$queryRawUnsafe<{ points: number | string | null }[]>(
            `SELECT qq.points FROM quiz_question qq
               JOIN quiz_section s ON s.id = qq.section_id
              WHERE qq.question_id = $1 AND s.quiz_id = $2 LIMIT 1`,
            input.questionId,
            attempt.quizId,
          );
          const points = num(ppRows[0]?.points ?? null) ?? question.points;
          maxScore += points;
          const outcome = gradeResponse(question, input.response, points);
          if (outcome.manual) anyManual = true;
          if (outcome.awarded !== null) score += outcome.awarded;

          const rRows = await db.$queryRawUnsafe<ResponseRow[]>(
            `INSERT INTO quiz_response
               (tenant_id, attempt_id, question_id, response, awarded, is_correct)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)
             RETURNING id, tenant_id, attempt_id, question_id, response,
                       awarded, is_correct`,
            ctx.tenantId,
            attemptId,
            input.questionId,
            JSON.stringify(input.response),
            outcome.awarded,
            outcome.isCorrect,
          );
          stored.push(toResponse(rRows[0]!));
        }

        const status: AttemptStatus = anyManual ? "submitted" : "graded";
        const updatedRows = await db.$queryRawUnsafe<AttemptRow[]>(
          `UPDATE quiz_attempt
              SET score = $2, max_score = $3, status = $4,
                  submitted_at = now(),
                  graded_at = CASE WHEN $4 = 'graded' THEN now() ELSE NULL END
            WHERE id = $1
           RETURNING id, tenant_id, quiz_id, user_id, attempt_no, status,
                     score, max_score, started_at, submitted_at, graded_at`,
          attemptId,
          score,
          maxScore,
          status,
        );
        return { ok: true, attempt: toAttempt(updatedRows[0]!), responses: stored };
      });
    },

    async getAttempt(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AttemptRow[]>(
          `SELECT id, tenant_id, quiz_id, user_id, attempt_no, status,
                  score, max_score, started_at, submitted_at, graded_at
             FROM quiz_attempt WHERE id = $1 LIMIT 1`,
          id,
        );
        return rows[0] ? toAttempt(rows[0]) : null;
      });
    },
  };
}
