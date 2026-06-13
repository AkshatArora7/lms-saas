import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  gradeResponse,
  secureBody,
  type AddQuizQuestionInput,
  type AssembledQuiz,
  type AssessmentStore,
  type DeliveredQuestion,
  type NewLibraryInput,
  type NewQuestionInput,
  type NewQuizInput,
  type NewSectionInput,
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

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory AssessmentStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `ASSESSMENT_STORE=memory`. A pluggable `pick` makes section draws
 * deterministic under test.
 */
export class MemoryAssessmentStore implements AssessmentStore {
  private libraries: QuestionLibraryRecord[] = [];
  private questions: QuestionRecord[] = [];
  private quizzes: QuizRecord[] = [];
  private sections: QuizSectionRecord[] = [];
  private quizQuestions: QuizQuestionRecord[] = [];
  private attempts: QuizAttemptRecord[] = [];
  private responses: QuizResponseRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
    /** Draw `count` items from `pool`; default keeps the first `count`. */
    private readonly pick: <T>(pool: T[], count: number) => T[] = (
      pool,
      count,
    ) => pool.slice(0, count),
  ) {}

  async createLibrary(
    ctx: TenantContext,
    input: NewLibraryInput,
  ): Promise<QuestionLibraryRecord> {
    const library: QuestionLibraryRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId: input.courseId ?? null,
      name: input.name,
    };
    this.libraries.push(library);
    return library;
  }

  async listLibraries(ctx: TenantContext): Promise<QuestionLibraryRecord[]> {
    return this.libraries.filter((l) => l.tenantId === ctx.tenantId);
  }

  async addQuestion(
    ctx: TenantContext,
    libraryId: string,
    input: NewQuestionInput,
  ): Promise<QuestionRecord> {
    const question: QuestionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      libraryId,
      kind: input.kind,
      stem: input.stem,
      points: input.points ?? 1,
      body: input.body ?? {},
      difficulty: input.difficulty ?? null,
      createdAt: this.now().toISOString(),
    };
    this.questions.push(question);
    return question;
  }

  async listQuestions(
    ctx: TenantContext,
    libraryId: string,
  ): Promise<QuestionRecord[]> {
    return this.questions.filter(
      (q) => q.tenantId === ctx.tenantId && q.libraryId === libraryId,
    );
  }

  async createQuiz(
    ctx: TenantContext,
    input: NewQuizInput,
  ): Promise<QuizRecord> {
    const quiz: QuizRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId: input.courseId,
      title: input.title,
      description: input.description ?? null,
      attemptsAllowed: input.attemptsAllowed ?? null,
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      shuffle: input.shuffle ?? false,
      availableFrom: input.availableFrom ?? null,
      availableUntil: input.availableUntil ?? null,
      gradingMethod: input.gradingMethod ?? "highest",
      isPublished: false,
      createdAt: this.now().toISOString(),
    };
    this.quizzes.push(quiz);
    return quiz;
  }

  private findQuiz(ctx: TenantContext, id: string): QuizRecord | undefined {
    return this.quizzes.find((q) => q.id === id && q.tenantId === ctx.tenantId);
  }

  async getQuiz(
    ctx: TenantContext,
    id: string,
  ): Promise<AssembledQuiz | null> {
    const quiz = this.findQuiz(ctx, id);
    if (!quiz) return null;
    const sections = this.sections
      .filter((s) => s.tenantId === ctx.tenantId && s.quizId === id)
      .sort((a, b) => a.position - b.position)
      .map((section) => ({
        section,
        questions: this.quizQuestions
          .filter(
            (qq) =>
              qq.tenantId === ctx.tenantId && qq.sectionId === section.id,
          )
          .sort((a, b) => a.position - b.position)
          .map((qq) => ({
            ...qq,
            question: this.questions.find((q) => q.id === qq.questionId)!,
          }))
          .filter((qq) => qq.question !== undefined),
      }));
    return { quiz, sections };
  }

  async publishQuiz(
    ctx: TenantContext,
    id: string,
  ): Promise<QuizRecord | null> {
    const quiz = this.findQuiz(ctx, id);
    if (!quiz) return null;
    quiz.isPublished = true;
    return quiz;
  }

  async addSection(
    ctx: TenantContext,
    quizId: string,
    input: NewSectionInput,
  ): Promise<QuizSectionRecord | null> {
    if (!this.findQuiz(ctx, quizId)) return null;
    const section: QuizSectionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      quizId,
      title: input.title ?? null,
      position:
        input.position ??
        this.sections.filter(
          (s) => s.tenantId === ctx.tenantId && s.quizId === quizId,
        ).length,
      drawCount: input.drawCount ?? null,
    };
    this.sections.push(section);
    return section;
  }

  async addQuizQuestion(
    ctx: TenantContext,
    sectionId: string,
    input: AddQuizQuestionInput,
  ): Promise<QuizQuestionRecord | null> {
    const section = this.sections.find(
      (s) => s.id === sectionId && s.tenantId === ctx.tenantId,
    );
    if (!section) return null;
    const quizQuestion: QuizQuestionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      sectionId,
      questionId: input.questionId,
      points: input.points ?? null,
      position:
        input.position ??
        this.quizQuestions.filter(
          (qq) => qq.tenantId === ctx.tenantId && qq.sectionId === sectionId,
        ).length,
    };
    this.quizQuestions.push(quizQuestion);
    return quizQuestion;
  }

  async startAttempt(
    ctx: TenantContext,
    quizId: string,
    userId: string,
    now: Date = this.now(),
  ): Promise<StartAttemptResult> {
    const quiz = this.findQuiz(ctx, quizId);
    if (!quiz) return { ok: false, reason: "unknown_quiz" };
    if (!quiz.isPublished) return { ok: false, reason: "not_published" };
    if (quiz.availableFrom && now < new Date(quiz.availableFrom)) {
      return { ok: false, reason: "not_available" };
    }
    if (quiz.availableUntil && now > new Date(quiz.availableUntil)) {
      return { ok: false, reason: "not_available" };
    }

    const prior = this.attempts.filter(
      (a) =>
        a.tenantId === ctx.tenantId &&
        a.quizId === quizId &&
        a.userId === userId,
    );
    if (
      quiz.attemptsAllowed !== null &&
      prior.length >= quiz.attemptsAllowed
    ) {
      return { ok: false, reason: "no_attempts_left" };
    }

    const assembled = await this.getQuiz(ctx, quizId);
    const delivered: DeliveredQuestion[] = [];
    for (const { section, questions } of assembled!.sections) {
      const chosen =
        section.drawCount !== null && section.drawCount < questions.length
          ? this.pick(questions, section.drawCount)
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

    const attempt: QuizAttemptRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      quizId,
      userId,
      attemptNo: prior.length + 1,
      status: "in_progress",
      score: null,
      maxScore: null,
      startedAt: now.toISOString(),
      submittedAt: null,
      gradedAt: null,
    };
    this.attempts.push(attempt);
    return { ok: true, attempt, questions: delivered };
  }

  async submitAttempt(
    ctx: TenantContext,
    attemptId: string,
    responses: ResponseInput[],
  ): Promise<SubmitAttemptResult> {
    const attempt = this.attempts.find(
      (a) => a.id === attemptId && a.tenantId === ctx.tenantId,
    );
    if (!attempt) return { ok: false, reason: "unknown_attempt" };
    if (attempt.status !== "in_progress") {
      return { ok: false, reason: "already_submitted" };
    }

    const effectivePoints = (questionId: string, question: QuestionRecord) => {
      const qq = this.quizQuestions.find(
        (x) =>
          x.tenantId === ctx.tenantId &&
          x.questionId === questionId &&
          this.sections.some(
            (s) => s.id === x.sectionId && s.quizId === attempt.quizId,
          ),
      );
      return qq?.points ?? question.points;
    };

    const nowIso = this.now().toISOString();
    let score = 0;
    let maxScore = 0;
    let anyManual = false;
    const stored: QuizResponseRecord[] = [];

    for (const input of responses) {
      const question = this.questions.find(
        (q) => q.id === input.questionId && q.tenantId === ctx.tenantId,
      );
      if (!question) continue;
      const points = effectivePoints(input.questionId, question);
      maxScore += points;
      const outcome = gradeResponse(question, input.response, points);
      if (outcome.manual) anyManual = true;
      if (outcome.awarded !== null) score += outcome.awarded;

      const record: QuizResponseRecord = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        attemptId,
        questionId: input.questionId,
        response: input.response,
        awarded: outcome.awarded,
        isCorrect: outcome.isCorrect,
      };
      this.responses.push(record);
      stored.push(record);
    }

    attempt.score = score;
    attempt.maxScore = maxScore;
    attempt.submittedAt = nowIso;
    if (anyManual) {
      attempt.status = "submitted";
    } else {
      attempt.status = "graded";
      attempt.gradedAt = nowIso;
    }
    return { ok: true, attempt, responses: stored };
  }

  async getAttempt(
    ctx: TenantContext,
    id: string,
  ): Promise<QuizAttemptRecord | null> {
    return (
      this.attempts.find((a) => a.id === id && a.tenantId === ctx.tenantId) ??
      null
    );
  }
}

/** Build a MemoryAssessmentStore pre-seeded with a small published quiz. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryAssessmentStore {
  const store = new MemoryAssessmentStore(generateId, now);
  return store;
}
