import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import {
  buildQuestionGenMessages,
  FakeChatModel,
  parseQuestionDrafts,
  type QuestionDraft,
  type QuestionGenParams,
} from "./chat.js";
import { makeEmbedder } from "./embedder.js";
import { buildApp } from "./main.js";
import { createSeededMemoryStore, DEMO_TENANT_ID } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  GROQ_MODEL: "llama-3.3-70b-versatile",
} as unknown as AppConfig;

const USER_ID = "44444444-4444-4444-4444-444444444444";
const HEADERS = { "x-tenant-id": DEMO_TENANT_ID, "x-user-id": USER_ID };
const COURSE = "demo-course";

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return {
    tenantId,
    tier: "pool",
    databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
  };
}

function buildTestApp() {
  return buildApp({
    config,
    store: createSeededMemoryStore(),
    resolveTenant,
    embedder: makeEmbedder(),
    chat: new FakeChatModel(),
  });
}

const ALL_KINDS = [
  "multiple_choice",
  "true_false",
  "short_answer",
] as const;

function params(overrides: Partial<QuestionGenParams> = {}): QuestionGenParams {
  return {
    count: 5,
    kinds: [...ALL_KINDS],
    difficulty: "medium",
    topic: "Photosynthesis",
    ...overrides,
  };
}

describe("buildQuestionGenMessages", () => {
  it("includes topic, sourceText, count, kinds, and difficulty", () => {
    const messages = buildQuestionGenMessages(
      params({
        count: 3,
        kinds: ["multiple_choice", "true_false"],
        difficulty: "hard",
        topic: "Cellular respiration",
        sourceText: "ATP is the energy currency of the cell.",
      }),
    );
    expect(messages[0]!.role).toBe("system");
    const user = messages[1]!.content;
    expect(user).toContain("3");
    expect(user).toContain("multiple_choice, true_false");
    expect(user).toContain("hard");
    expect(user).toContain("Cellular respiration");
    expect(user).toContain("ATP is the energy currency of the cell.");
  });
});

describe("parseQuestionDrafts", () => {
  it("parses a valid mixed array and stamps defaults", () => {
    const raw = JSON.stringify([
      {
        kind: "multiple_choice",
        stem: "Pick one",
        body: {
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          correct: "a",
        },
      },
      { kind: "true_false", stem: "T or F?", body: { correct: false } },
      {
        kind: "short_answer",
        stem: "Define X",
        points: 2,
        difficulty: "hard",
        body: { answers: ["x"], caseSensitive: true },
      },
    ]);
    const drafts = parseQuestionDrafts(raw, params());
    expect(drafts).toHaveLength(3);
    expect(drafts[0]).toMatchObject({ kind: "multiple_choice", points: 1, difficulty: "medium" });
    expect(drafts[2]).toMatchObject({ kind: "short_answer", points: 2, difficulty: "hard" });
  });

  it("strips a ```json fence wrapper", () => {
    const raw =
      "```json\n" +
      JSON.stringify([
        { kind: "true_false", stem: "Q?", body: { correct: true } },
      ]) +
      "\n```";
    const drafts = parseQuestionDrafts(raw, params());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kind).toBe("true_false");
  });

  it("drops invalid elements but keeps valid ones", () => {
    const raw = JSON.stringify([
      { kind: "true_false", stem: "ok", body: { correct: true } },
      { kind: "true_false", stem: "bad body", body: { correct: "yes" } },
      { kind: "multiple_choice", stem: "no correct match", body: { options: [{ id: "a", label: "A" }], correct: "z" } },
      { kind: "short_answer", stem: "no answers", body: { answers: [] } },
      { kind: "essay", stem: "unsupported kind", body: {} },
      "not an object",
    ]);
    const drafts = parseQuestionDrafts(raw, params());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.stem).toBe("ok");
  });

  it("clamps the result to the requested count", () => {
    const raw = JSON.stringify(
      Array.from({ length: 8 }, () => ({
        kind: "true_false",
        stem: "Q?",
        body: { correct: true },
      })),
    );
    const drafts = parseQuestionDrafts(raw, params({ count: 3 }));
    expect(drafts).toHaveLength(3);
  });

  it("drops kinds that were not requested", () => {
    const raw = JSON.stringify([
      { kind: "multiple_choice", stem: "mc", body: { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], correct: "a" } },
      { kind: "true_false", stem: "tf", body: { correct: true } },
    ]);
    const drafts = parseQuestionDrafts(raw, params({ kinds: ["true_false"] }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kind).toBe("true_false");
  });

  it("returns [] for unparseable garbage", () => {
    expect(parseQuestionDrafts("not json at all", params())).toEqual([]);
    expect(parseQuestionDrafts("{}", params())).toEqual([]);
    expect(parseQuestionDrafts('"a string"', params())).toEqual([]);
  });
});

function assertNewQuestionInputShape(draft: QuestionDraft): void {
  // Each draft must be 1:1 with assessment's NewQuestionInput (AC2).
  expect(draft).toHaveProperty("kind");
  expect(draft).toHaveProperty("stem");
  expect(draft).toHaveProperty("body");
  expect(typeof draft.stem).toBe("string");
  expect(typeof draft.body).toBe("object");
}

describe("POST /courses/:courseId/question-drafts", () => {
  it("returns N drafts of the requested kinds with valid body shapes (AC1)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: HEADERS,
      payload: { topic: "Mitosis", count: 3, difficulty: "hard" },
    });
    expect(res.statusCode).toBe(200);
    const drafts = (res.json() as { drafts: QuestionDraft[] }).drafts;
    expect(drafts).toHaveLength(3);
    for (const draft of drafts) {
      assertNewQuestionInputShape(draft);
      expect(draft.difficulty).toBe("hard"); // difficulty echoed (AC3 editable JSON)
    }
    const mc = drafts.find((d) => d.kind === "multiple_choice");
    if (mc) {
      const body = mc.body as { options: { id: string }[]; correct: string };
      expect(body.options.some((o) => o.id === body.correct)).toBe(true);
    }
  });

  it("honors a single requested kind", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: HEADERS,
      payload: { topic: "Osmosis", count: 4, kinds: ["short_answer"] },
    });
    expect(res.statusCode).toBe(200);
    const drafts = (res.json() as { drafts: QuestionDraft[] }).drafts;
    expect(drafts).toHaveLength(4);
    expect(drafts.every((d) => d.kind === "short_answer")).toBe(true);
    for (const draft of drafts) {
      const body = draft.body as { answers: string[] };
      expect(Array.isArray(body.answers)).toBe(true);
      expect(body.answers.length).toBeGreaterThan(0);
    }
  });

  it("generates from sourceText alone", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: HEADERS,
      payload: { sourceText: "The mitochondrion is the powerhouse of the cell.", count: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { drafts: QuestionDraft[] }).drafts).toHaveLength(2);
  });

  it("rejects when neither topic nor sourceText is provided (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: HEADERS,
      payload: { count: 3 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("rejects an out-of-range count (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: HEADERS,
      payload: { topic: "X", count: 99 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("rejects an unsupported kind (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: HEADERS,
      payload: { topic: "X", kinds: ["essay"] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("requires x-tenant-id (400 tenant_required)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: { "x-user-id": USER_ID },
      payload: { topic: "X" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });

  it("requires x-user-id (400 user_required)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/question-drafts`,
      headers: { "x-tenant-id": DEMO_TENANT_ID },
      payload: { topic: "X" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "user_required" });
  });
});
