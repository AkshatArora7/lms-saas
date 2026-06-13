import type { TenantContext } from "@lms/types";

export type QuestionKind =
  | "multiple_choice"
  | "multi_select"
  | "true_false"
  | "short_answer"
  | "essay"
  | "matching"
  | "ordering"
  | "fill_blank"
  | "numeric";

export type AttemptStatus = "in_progress" | "submitted" | "graded";

export type GradingMethod = "highest" | "latest" | "average" | "first";

/** Subjective kinds route to manual grading; everything else auto-grades. */
export const SUBJECTIVE_KINDS: readonly QuestionKind[] = ["essay"];

export interface QuestionLibraryRecord {
  id: string;
  tenantId: string;
  courseId: string | null;
  name: string;
}

/**
 * A reusable question. `body` carries kind-specific structure, e.g.
 * - true_false: `{ correct: boolean }`
 * - multiple_choice: `{ options: [{id,label}], correct: id }`
 * - multi_select: `{ options: [...], correct: [id] }`
 * - short_answer: `{ answers: string[], caseSensitive?: boolean }`
 * - numeric: `{ answer: number, tolerance?: number }`
 * - essay: free text (manual grade)
 */
export interface QuestionRecord {
  id: string;
  tenantId: string;
  libraryId: string | null;
  kind: QuestionKind;
  stem: string;
  points: number;
  body: Record<string, unknown>;
  difficulty: string | null;
  createdAt: string;
}

export interface QuizRecord {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  description: string | null;
  attemptsAllowed: number | null;
  timeLimitMinutes: number | null;
  shuffle: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
  gradingMethod: GradingMethod;
  isPublished: boolean;
  createdAt: string;
}

export interface QuizSectionRecord {
  id: string;
  tenantId: string;
  quizId: string;
  title: string | null;
  position: number;
  /** NULL = include every question in the section; N = draw N at random. */
  drawCount: number | null;
}

export interface QuizQuestionRecord {
  id: string;
  tenantId: string;
  sectionId: string;
  questionId: string;
  /** Override the question's intrinsic points for this quiz. */
  points: number | null;
  position: number;
}

export interface QuizAttemptRecord {
  id: string;
  tenantId: string;
  quizId: string;
  userId: string;
  attemptNo: number;
  status: AttemptStatus;
  score: number | null;
  maxScore: number | null;
  startedAt: string;
  submittedAt: string | null;
  gradedAt: string | null;
}

export interface QuizResponseRecord {
  id: string;
  tenantId: string;
  attemptId: string;
  questionId: string;
  response: Record<string, unknown>;
  awarded: number | null;
  isCorrect: boolean | null;
}

/** A question as delivered to a candidate — answer keys stripped (secured). */
export interface DeliveredQuestion {
  questionId: string;
  kind: QuestionKind;
  stem: string;
  points: number;
  /** `body` with answer keys (`correct`, `answer`, `answers`) removed. */
  prompt: Record<string, unknown>;
}

export interface NewLibraryInput {
  courseId?: string | null;
  name: string;
}

export interface NewQuestionInput {
  kind: QuestionKind;
  stem: string;
  points?: number;
  body?: Record<string, unknown>;
  difficulty?: string | null;
}

export interface NewQuizInput {
  courseId: string;
  title: string;
  description?: string | null;
  attemptsAllowed?: number | null;
  timeLimitMinutes?: number | null;
  shuffle?: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
  gradingMethod?: GradingMethod;
}

export interface NewSectionInput {
  title?: string | null;
  position?: number;
  drawCount?: number | null;
}

export interface AddQuizQuestionInput {
  questionId: string;
  points?: number | null;
  position?: number;
}

export interface ResponseInput {
  questionId: string;
  response: Record<string, unknown>;
}

export type StartAttemptResult =
  | {
      ok: true;
      attempt: QuizAttemptRecord;
      questions: DeliveredQuestion[];
    }
  | {
      ok: false;
      reason:
        | "unknown_quiz"
        | "not_published"
        | "not_available"
        | "no_attempts_left";
    };

export type SubmitAttemptResult =
  | { ok: true; attempt: QuizAttemptRecord; responses: QuizResponseRecord[] }
  | { ok: false; reason: "unknown_attempt" | "already_submitted" };

/** Assembled quiz: the quiz row plus its sections, each with its questions. */
export interface AssembledQuiz {
  quiz: QuizRecord;
  sections: {
    section: QuizSectionRecord;
    questions: (QuizQuestionRecord & { question: QuestionRecord })[];
  }[];
}

/**
 * Persistence boundary for the assessment (quizzing) service. Routes depend
 * only on this interface, so production uses an RLS-scoped Postgres
 * implementation while tests inject an in-memory one.
 */
export interface AssessmentStore {
  createLibrary(
    ctx: TenantContext,
    input: NewLibraryInput,
  ): Promise<QuestionLibraryRecord>;
  listLibraries(ctx: TenantContext): Promise<QuestionLibraryRecord[]>;

  addQuestion(
    ctx: TenantContext,
    libraryId: string,
    input: NewQuestionInput,
  ): Promise<QuestionRecord>;
  listQuestions(
    ctx: TenantContext,
    libraryId: string,
  ): Promise<QuestionRecord[]>;

  createQuiz(ctx: TenantContext, input: NewQuizInput): Promise<QuizRecord>;
  getQuiz(ctx: TenantContext, id: string): Promise<AssembledQuiz | null>;
  publishQuiz(ctx: TenantContext, id: string): Promise<QuizRecord | null>;

  addSection(
    ctx: TenantContext,
    quizId: string,
    input: NewSectionInput,
  ): Promise<QuizSectionRecord | null>;
  addQuizQuestion(
    ctx: TenantContext,
    sectionId: string,
    input: AddQuizQuestionInput,
  ): Promise<QuizQuestionRecord | null>;

  startAttempt(
    ctx: TenantContext,
    quizId: string,
    userId: string,
    now?: Date,
  ): Promise<StartAttemptResult>;

  submitAttempt(
    ctx: TenantContext,
    attemptId: string,
    responses: ResponseInput[],
  ): Promise<SubmitAttemptResult>;

  getAttempt(
    ctx: TenantContext,
    id: string,
  ): Promise<QuizAttemptRecord | null>;
}

/** Outcome of grading a single response against its question. */
export interface GradeOutcome {
  awarded: number | null;
  isCorrect: boolean | null;
  /** True when the item requires manual grading (subjective). */
  manual: boolean;
}

function normalize(value: unknown, caseSensitive: boolean): string {
  const s = String(value ?? "").trim();
  return caseSensitive ? s : s.toLowerCase();
}

function sameSet(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = new Set(a.map((x) => String(x)));
  return b.every((x) => sa.has(String(x)));
}

/**
 * Auto-grade a single response. Objective kinds resolve to a definite
 * awarded/correct pair; subjective kinds (essay) and items without an answer
 * key are flagged `manual` so the attempt routes to the gradebook.
 */
export function gradeResponse(
  question: QuestionRecord,
  response: Record<string, unknown>,
  points: number,
): GradeOutcome {
  const body = question.body ?? {};
  const correct = (awarded: boolean): GradeOutcome => ({
    awarded: awarded ? points : 0,
    isCorrect: awarded,
    manual: false,
  });

  switch (question.kind) {
    case "true_false":
      if (typeof body.correct !== "boolean") break;
      return correct(response.value === body.correct);
    case "multiple_choice":
      if (body.correct === undefined) break;
      return correct(String(response.choice) === String(body.correct));
    case "multi_select":
      if (!Array.isArray(body.correct)) break;
      return correct(sameSet(response.choices, body.correct));
    case "short_answer": {
      if (!Array.isArray(body.answers)) break;
      const cs = body.caseSensitive === true;
      const given = normalize(response.text, cs);
      const accepted = body.answers.map((a) => normalize(a, cs));
      return correct(accepted.includes(given));
    }
    case "numeric": {
      if (typeof body.answer !== "number") break;
      const tolerance = typeof body.tolerance === "number" ? body.tolerance : 0;
      const given = Number(response.value);
      if (Number.isNaN(given)) return correct(false);
      return correct(Math.abs(given - body.answer) <= tolerance);
    }
    default:
      break;
  }
  return { awarded: null, isCorrect: null, manual: true };
}

/** Strip answer keys so a delivered question never leaks its solution. */
export function secureBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { correct, answer, answers, ...rest } = body;
  void correct;
  void answer;
  void answers;
  return rest;
}
