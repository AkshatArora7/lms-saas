import type { AppConfig } from "@lms/config";
import { MemoryRateLimiter } from "@lms/ratelimit";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import {
  FakeChatModel,
  type ChatCompleteOptions,
  type ChatMessage,
  type ChatModel,
} from "./chat.js";
import { makeEmbedder } from "./embedder.js";
import { buildApp } from "./main.js";
import { createSeededMemoryStore, DEMO_TENANT_ID } from "./store.memory.js";

const baseConfig = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  GROQ_MODEL: "llama-3.3-70b-versatile",
  GROQ_MAX_TOKENS: 1024,
  AI_CHAT_RATE_LIMIT_MAX: 120,
  AI_CHAT_USER_RATE_LIMIT_MAX: 30,
  AI_CHAT_RATE_LIMIT_WINDOW_SECONDS: 60,
  AI_CHAT_DAILY_TENANT_REQUEST_CEILING: 2000,
  AI_CHAT_DAILY_TENANT_TOKEN_CEILING: 0,
} as unknown as AppConfig;

const TENANT_A: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return TENANT_A;
}

const USER_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID_2 = "55555555-5555-5555-5555-555555555555";
const CHAT_URL = "/courses/demo-course/chat";

/** A ChatModel wrapping the offline FakeChatModel that tracks call count. */
class CountingChat implements ChatModel {
  calls = 0;
  private readonly inner = new FakeChatModel();
  async complete(
    messages: ChatMessage[],
    options?: ChatCompleteOptions,
  ): Promise<string> {
    this.calls += 1;
    return this.inner.complete(messages, options);
  }
}

function chat(payload: { message: string }, userId = USER_ID) {
  return {
    method: "POST" as const,
    url: CHAT_URL,
    headers: { "x-tenant-id": DEMO_TENANT_ID, "x-user-id": userId },
    payload,
  };
}

/** Today's UTC window date, matching the handler's `new Date().slice(0,10)`. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("ai /chat rate limit + cost ceiling (#309)", () => {
  it("allows a request under the limits, calls the model, and increments usage", async () => {
    const store = createSeededMemoryStore();
    const counting = new CountingChat();
    const app = buildApp({
      config: baseConfig,
      store,
      resolveTenant,
      embedder: makeEmbedder(),
      chat: counting,
      limiter: new MemoryRateLimiter(() => 1_000),
    });

    const res = await app.inject(chat({ message: "How does photosynthesis work?" }));
    expect(res.statusCode).toBe(200);
    expect(counting.calls).toBe(1);

    const usage = await store.getTenantDailyUsage(TENANT_A, todayUtc());
    expect(usage.requestCount).toBe(1);
    expect(usage.tokenEstimate).toBe(1024); // GROQ_MAX_TOKENS worst-case estimate
    await app.close();
  });

  it("returns 429 rate_limited once the per-user limit is exceeded", async () => {
    const app = buildApp({
      config: { ...baseConfig, AI_CHAT_USER_RATE_LIMIT_MAX: 2 } as AppConfig,
      store: createSeededMemoryStore(),
      resolveTenant,
      embedder: makeEmbedder(),
      chat: new FakeChatModel(),
      limiter: new MemoryRateLimiter(() => 1_000),
    });

    expect((await app.inject(chat({ message: "q1" }))).statusCode).toBe(200);
    expect((await app.inject(chat({ message: "q2" }))).statusCode).toBe(200);
    const blocked = await app.inject(chat({ message: "q3" }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: "rate_limited" });
    expect(blocked.headers["retry-after"]).toBe("60");
    expect(blocked.headers["ratelimit-limit"]).toBe("2");
    await app.close();
  });

  it("returns 429 rate_limited once the per-tenant limit is exceeded (across users)", async () => {
    const app = buildApp({
      // High per-user, low per-tenant: two users together exhaust the tenant
      // budget without any single user tripping the per-user limit first.
      config: {
        ...baseConfig,
        AI_CHAT_USER_RATE_LIMIT_MAX: 50,
        AI_CHAT_RATE_LIMIT_MAX: 2,
      } as AppConfig,
      store: createSeededMemoryStore(),
      resolveTenant,
      embedder: makeEmbedder(),
      chat: new FakeChatModel(),
      limiter: new MemoryRateLimiter(() => 1_000),
    });

    expect(
      (await app.inject(chat({ message: "a1" }, USER_ID))).statusCode,
    ).toBe(200);
    expect(
      (await app.inject(chat({ message: "b1" }, USER_ID_2))).statusCode,
    ).toBe(200);
    const blocked = await app.inject(chat({ message: "a2" }, USER_ID));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: "rate_limited" });
    await app.close();
  });

  it("returns 429 cost_exceeded at the daily ceiling without calling the model", async () => {
    const store = createSeededMemoryStore();
    const counting = new CountingChat();
    const app = buildApp({
      config: {
        ...baseConfig,
        AI_CHAT_DAILY_TENANT_REQUEST_CEILING: 1,
      } as AppConfig,
      store,
      resolveTenant,
      embedder: makeEmbedder(),
      chat: counting,
      limiter: new MemoryRateLimiter(() => 1_000),
    });

    // First call succeeds and pushes usage to the ceiling (request_count = 1).
    const first = await app.inject(chat({ message: "first" }));
    expect(first.statusCode).toBe(200);
    expect(counting.calls).toBe(1);

    // Second call is blocked by the ceiling BEFORE the model is invoked.
    const blocked = await app.inject(chat({ message: "second" }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: "cost_exceeded" });
    expect(counting.calls).toBe(1); // model NOT called for the blocked request
    await app.close();
  });

  it("returns 429 cost_exceeded when a pre-seeded daily usage row is at the ceiling", async () => {
    const store = createSeededMemoryStore();
    store.seedUsage(DEMO_TENANT_ID, todayUtc(), {
      requestCount: 2000,
      tokenEstimate: 0,
    });
    const counting = new CountingChat();
    const app = buildApp({
      config: baseConfig,
      store,
      resolveTenant,
      embedder: makeEmbedder(),
      chat: counting,
      limiter: new MemoryRateLimiter(() => 1_000),
    });

    const blocked = await app.inject(chat({ message: "over ceiling" }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: "cost_exceeded" });
    expect(counting.calls).toBe(0);
    await app.close();
  });
});
