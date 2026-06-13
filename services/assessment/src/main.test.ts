import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemoryAssessmentStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const OTHER_TENANT: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER_TENANT.tenantId ? OTHER_TENANT : TENANT;
}

function buildTestApp(store = new MemoryAssessmentStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };
type App = ReturnType<typeof buildTestApp>;

async function post(app: App, url: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url, headers: HEADERS, payload });
}

/**
 * Author a published quiz with one library, two objective questions (a
 * true/false and a multiple-choice) in a single section. Returns ids.
 */
async function seedQuiz(app: App) {
  const lib = (
    await post(app, "/question-libraries", { name: "Bank" })
  ).json() as { library: { id: string } };

  const tf = (
    await post(app, `/question-libraries/${lib.library.id}/questions`, {
      kind: "true_false",
      stem: "The sky is blue.",
      points: 2,
      body: { correct: true },
    })
  ).json() as { question: { id: string } };

  const mc = (
    await post(app, `/question-libraries/${lib.library.id}/questions`, {
      kind: "multiple_choice",
      stem: "2 + 2 = ?",
      points: 3,
      body: { options: [{ id: "a" }, { id: "b" }], correct: "b" },
    })
  ).json() as { question: { id: string } };

  const essay = (
    await post(app, `/question-libraries/${lib.library.id}/questions`, {
      kind: "essay",
      stem: "Discuss.",
      points: 5,
      body: {},
    })
  ).json() as { question: { id: string } };

  const quiz = (
    await post(app, "/quizzes", { courseId: "course-1", title: "Quiz 1" })
  ).json() as { quiz: { id: string } };

  const section = (
    await post(app, `/quizzes/${quiz.quiz.id}/sections`, { title: "S1" })
  ).json() as { section: { id: string } };

  await post(app, `/sections/${section.section.id}/questions`, {
    questionId: tf.question.id,
  });
  await post(app, `/sections/${section.section.id}/questions`, {
    questionId: mc.question.id,
  });

  await post(app, `/quizzes/${quiz.quiz.id}/publish`, {});

  return {
    quizId: quiz.quiz.id,
    sectionId: section.section.id,
    tfId: tf.question.id,
    mcId: mc.question.id,
    essayId: essay.question.id,
  };
}

describe("assessment service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "assessment", status: "ok" });
  });
});

describe("question banks", () => {
  it("creates a library and lists its questions", async () => {
    const app = buildTestApp();
    const lib = (
      await post(app, "/question-libraries", { name: "Bank" })
    ).json() as { library: { id: string } };
    await post(app, `/question-libraries/${lib.library.id}/questions`, {
      kind: "true_false",
      stem: "T?",
      body: { correct: true },
    });
    const list = await app.inject({
      method: "GET",
      url: `/question-libraries/${lib.library.id}/questions`,
      headers: HEADERS,
    });
    expect((list.json() as { questions: unknown[] }).questions).toHaveLength(1);
  });

  it("rejects an unknown question kind (400)", async () => {
    const app = buildTestApp();
    const lib = (
      await post(app, "/question-libraries", { name: "Bank" })
    ).json() as { library: { id: string } };
    const res = await post(
      app,
      `/question-libraries/${lib.library.id}/questions`,
      { kind: "telepathy", stem: "?" },
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("quiz authoring and attempts", () => {
  it("starts an attempt without leaking answer keys", async () => {
    const app = buildTestApp();
    const { quizId } = await seedQuiz(app);
    const res = await post(app, `/quizzes/${quizId}/attempts`, {
      userId: "stu-1",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json() as {
      questions: { prompt: Record<string, unknown> }[];
    };
    expect(json.questions).toHaveLength(2);
    for (const q of json.questions) {
      expect(q.prompt).not.toHaveProperty("correct");
    }
  });

  it("refuses to start an attempt on an unpublished quiz (409)", async () => {
    const app = buildTestApp();
    const quiz = (
      await post(app, "/quizzes", { courseId: "c", title: "Draft" })
    ).json() as { quiz: { id: string } };
    const res = await post(app, `/quizzes/${quiz.quiz.id}/attempts`, {
      userId: "stu-1",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_published" });
  });

  it("auto-grades objective responses and marks the attempt graded", async () => {
    const app = buildTestApp();
    const { quizId, tfId, mcId } = await seedQuiz(app);
    const start = (
      await post(app, `/quizzes/${quizId}/attempts`, { userId: "stu-1" })
    ).json() as { attempt: { id: string } };

    const submit = await post(app, `/attempts/${start.attempt.id}/submit`, {
      responses: [
        { questionId: tfId, response: { value: true } }, // correct -> 2
        { questionId: mcId, response: { choice: "a" } }, // wrong -> 0
      ],
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json()).toMatchObject({
      attempt: { status: "graded", score: 2, maxScore: 5 },
    });
  });

  it("routes essays to manual grading (status submitted)", async () => {
    const app = buildTestApp();
    const { quizId, tfId, essayId } = await seedQuiz(app);
    const start = (
      await post(app, `/quizzes/${quizId}/attempts`, { userId: "stu-2" })
    ).json() as { attempt: { id: string } };

    const submit = await post(app, `/attempts/${start.attempt.id}/submit`, {
      responses: [
        { questionId: tfId, response: { value: true } },
        { questionId: essayId, response: { text: "An essay." } },
      ],
    });
    expect(submit.json()).toMatchObject({ attempt: { status: "submitted" } });
  });

  it("rejects a double submit (409)", async () => {
    const app = buildTestApp();
    const { quizId, tfId } = await seedQuiz(app);
    const start = (
      await post(app, `/quizzes/${quizId}/attempts`, { userId: "stu-3" })
    ).json() as { attempt: { id: string } };
    await post(app, `/attempts/${start.attempt.id}/submit`, {
      responses: [{ questionId: tfId, response: { value: true } }],
    });
    const again = await post(app, `/attempts/${start.attempt.id}/submit`, {
      responses: [{ questionId: tfId, response: { value: false } }],
    });
    expect(again.statusCode).toBe(409);
  });

  it("enforces attempts_allowed (409 no_attempts_left)", async () => {
    const app = buildTestApp();
    const quiz = (
      await post(app, "/quizzes", {
        courseId: "c",
        title: "Single",
        attemptsAllowed: 1,
      })
    ).json() as { quiz: { id: string } };
    await post(app, `/quizzes/${quiz.quiz.id}/publish`, {});
    await post(app, `/quizzes/${quiz.quiz.id}/attempts`, { userId: "stu-1" });
    const second = await post(app, `/quizzes/${quiz.quiz.id}/attempts`, {
      userId: "stu-1",
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: "no_attempts_left" });
  });
});

describe("section draw and tenant isolation", () => {
  it("draws N questions from a pool", async () => {
    const app = buildTestApp();
    const lib = (
      await post(app, "/question-libraries", { name: "Pool" })
    ).json() as { library: { id: string } };
    const quiz = (
      await post(app, "/quizzes", { courseId: "c", title: "Pooled" })
    ).json() as { quiz: { id: string } };
    const section = (
      await post(app, `/quizzes/${quiz.quiz.id}/sections`, {
        title: "Pool",
        drawCount: 2,
      })
    ).json() as { section: { id: string } };
    for (let i = 0; i < 5; i++) {
      const q = (
        await post(app, `/question-libraries/${lib.library.id}/questions`, {
          kind: "true_false",
          stem: `Q${i}`,
          body: { correct: true },
        })
      ).json() as { question: { id: string } };
      await post(app, `/sections/${section.section.id}/questions`, {
        questionId: q.question.id,
      });
    }
    await post(app, `/quizzes/${quiz.quiz.id}/publish`, {});
    const start = await post(app, `/quizzes/${quiz.quiz.id}/attempts`, {
      userId: "stu-1",
    });
    expect(
      (start.json() as { questions: unknown[] }).questions,
    ).toHaveLength(2);
  });

  it("isolates libraries across tenants", async () => {
    const app = buildTestApp();
    await post(app, "/question-libraries", { name: "OurBank" });
    const theirs = await app.inject({
      method: "GET",
      url: "/question-libraries",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect(
      (theirs.json() as { libraries: unknown[] }).libraries,
    ).toEqual([]);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/question-libraries",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
