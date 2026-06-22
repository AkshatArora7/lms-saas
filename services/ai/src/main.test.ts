import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { FakeChatModel, buildGroundedMessages } from "./chat.js";
import { HashingEmbedder, makeEmbedder } from "./embedder.js";
import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryAiStore,
} from "./store.memory.js";
import {
  EMBED_DIM,
  chunkText,
  cosineSimilarity,
  toVectorLiteral,
} from "./store.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  GROQ_MODEL: "llama-3.3-70b-versatile",
} as unknown as AppConfig;

const TENANT_A: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const TENANT_B: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === TENANT_B.tenantId ? TENANT_B : TENANT_A;
}

const COURSE_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "44444444-4444-4444-4444-444444444444";

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID, "x-user-id": USER_ID };

/** Build a test app wired to a memory store + deterministic offline deps. */
function buildTestApp(store = createSeededMemoryStore()) {
  return buildApp({
    config,
    store,
    resolveTenant,
    embedder: makeEmbedder(),
    chat: new FakeChatModel(),
  });
}

describe("ai service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "ai", status: "ok" });
  });
});

describe("pure helpers", () => {
  it("chunks long text on word boundaries and skips blank input", () => {
    expect(chunkText("   ")).toEqual([]);
    expect(chunkText("hello world")).toEqual(["hello world"]);
    const long = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(long, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 40)).toBe(true);
  });

  it("produces 1024-dim L2-normalized embeddings", async () => {
    const [vec] = await new HashingEmbedder().embed(["photosynthesis in plants"]);
    expect(vec).toHaveLength(EMBED_DIM);
    const norm = Math.sqrt(vec!.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("computes cosine similarity (identical=1, orthogonal=0)", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([1, 0.5, -2])).toBe("[1,0.5,-2]");
  });

  it("builds grounded messages with numbered context or a no-context note", () => {
    const withCtx = buildGroundedMessages("q?", [
      { sourceType: "content_topic", sourceId: "a", chunk: "the answer", score: 1 },
    ]);
    expect(withCtx[1]!.content).toContain("[1] the answer");
    const empty = buildGroundedMessages("q?", []);
    expect(empty[1]!.content).toContain("no relevant course content");
  });
});

describe("reindex", () => {
  it("embeds a course's content topics", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/courses/demo-course/reindex",
      headers: HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      courseId: "demo-course",
      topics: 2,
    });
    expect((res.json() as { embedded: number }).embedded).toBeGreaterThan(0);
  });

  it("returns zeros for a course with no content", async () => {
    const app = buildTestApp(new MemoryAiStore());
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE_ID}/reindex`,
      headers: HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ topics: 0, chunks: 0, embedded: 0 });
  });
});

describe("chat (RAG)", () => {
  it("answers with citations grounded in reindexed content", async () => {
    const app = buildTestApp();
    await app.inject({
      method: "POST",
      url: "/courses/demo-course/reindex",
      headers: HEADERS,
      payload: {},
    });
    const res = await app.inject({
      method: "POST",
      url: "/courses/demo-course/chat",
      headers: HEADERS,
      payload: { message: "How does photosynthesis work?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      chatId: string;
      answer: string;
      citations: { chunk: string; score: number }[];
    };
    expect(body.chatId).toBeTruthy();
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.citations.length).toBeGreaterThan(0);
    expect(
      body.citations.some((c) => c.chunk.includes("Photosynthesis")),
    ).toBe(true);
  });

  it("answers sanely for an empty course (no citations)", async () => {
    const app = buildTestApp(new MemoryAiStore());
    const res = await app.inject({
      method: "POST",
      url: `/courses/${COURSE_ID}/chat`,
      headers: HEADERS,
      payload: { message: "Anything?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { citations: unknown[]; answer: string };
    expect(body.citations).toEqual([]);
    expect(body.answer.length).toBeGreaterThan(0);
  });

  it("rejects an empty message (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/courses/demo-course/chat",
      headers: HEADERS,
      payload: { message: "  " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires x-user-id (400 user_required)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/courses/demo-course/chat",
      headers: { "x-tenant-id": DEMO_TENANT_ID },
      payload: { message: "Hi" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "user_required" });
  });

  it("continues an existing chat and lists its messages", async () => {
    const app = buildTestApp();
    await app.inject({
      method: "POST",
      url: "/courses/demo-course/reindex",
      headers: HEADERS,
      payload: {},
    });
    const first = await app.inject({
      method: "POST",
      url: "/courses/demo-course/chat",
      headers: HEADERS,
      payload: { message: "First question about water" },
    });
    const chatId = (first.json() as { chatId: string }).chatId;
    await app.inject({
      method: "POST",
      url: "/courses/demo-course/chat",
      headers: HEADERS,
      payload: { message: "Follow-up", chatId },
    });

    const chats = await app.inject({
      method: "GET",
      url: "/courses/demo-course/chats",
      headers: HEADERS,
    });
    expect((chats.json() as { chats: unknown[] }).chats).toHaveLength(1);

    const messages = await app.inject({
      method: "GET",
      url: `/chats/${chatId}/messages`,
      headers: HEADERS,
    });
    // 2 turns x (user + assistant) = 4 messages.
    expect((messages.json() as { messages: unknown[] }).messages).toHaveLength(4);
  });
});

describe("tenant isolation", () => {
  it("does not retrieve another tenant's embeddings", async () => {
    const app = buildTestApp();
    // Tenant A reindexes demo-course content.
    await app.inject({
      method: "POST",
      url: "/courses/demo-course/reindex",
      headers: HEADERS,
      payload: {},
    });
    // Tenant B asks about the same course → sees no context.
    const res = await app.inject({
      method: "POST",
      url: "/courses/demo-course/chat",
      headers: { "x-tenant-id": TENANT_B.tenantId, "x-user-id": USER_ID },
      payload: { message: "How does photosynthesis work?" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { citations: unknown[] }).citations).toEqual([]);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/courses/demo-course/chat",
      headers: { "x-user-id": USER_ID },
      payload: { message: "Hi" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
