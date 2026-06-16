import { signAccessToken } from "@lms/auth";
import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  MemoryRateLimiter,
  UpstashRateLimiter,
  createRateLimiter,
} from "./ratelimit.js";

const config = {
  NODE_ENV: "test",
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  JWT_SECRET: "test-secret-at-least-16-chars",
  JWT_AUDIENCE: "lms-api",
  ACCESS_TOKEN_TTL: 900,
  REFRESH_TOKEN_TTL: 2_592_000,
  RATE_LIMIT_MAX: 600,
  RATE_LIMIT_WINDOW_SECONDS: 60,
} as unknown as AppConfig;

async function token(tenantId: string): Promise<string> {
  return signAccessToken(
    {
      sub: "user-1",
      tenantId,
      tier: "pool",
      roles: ["learner"] as never,
      scopes: [],
    },
    { secret: config.JWT_SECRET, audience: config.JWT_AUDIENCE, ttlSeconds: 900 },
  );
}

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

describe("MemoryRateLimiter", () => {
  it("allows up to the limit, then blocks with a retry-after", async () => {
    const limiter = new MemoryRateLimiter(() => 1_000);
    const first = await limiter.check("k", 2, 60);
    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    const second = await limiter.check("k", 2, 60);
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    const third = await limiter.check("k", 2, 60);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.retryAfterSeconds).toBe(60);
  });

  it("resets after the window elapses", async () => {
    let nowMs = 1_000;
    const limiter = new MemoryRateLimiter(() => nowMs);
    expect((await limiter.check("k", 1, 30)).allowed).toBe(true);
    expect((await limiter.check("k", 1, 30)).allowed).toBe(false);
    nowMs += 30_000; // window elapsed
    expect((await limiter.check("k", 1, 30)).allowed).toBe(true);
  });

  it("isolates keys (per tenant)", async () => {
    const limiter = new MemoryRateLimiter(() => 0);
    expect((await limiter.check("a", 1, 60)).allowed).toBe(true);
    // Different key still has its full budget.
    expect((await limiter.check("b", 1, 60)).allowed).toBe(true);
  });
});

describe("UpstashRateLimiter", () => {
  it("counts via the REST pipeline and blocks when over budget", async () => {
    const calls: string[] = [];
    let count = 0;
    const fakeFetch = async (url: string, _init: { body: string }) => {
      calls.push(url);
      count += 1; // emulate INCR
      return {
        json: async () => [{ result: count }, { result: 1 }, { result: 5_000 }],
      };
    };
    const limiter = new UpstashRateLimiter(
      "https://example.upstash.io",
      "tok",
      fakeFetch as never,
    );
    expect((await limiter.check("k", 2, 60)).allowed).toBe(true); // count 1
    expect((await limiter.check("k", 2, 60)).allowed).toBe(true); // count 2
    const blocked = await limiter.check("k", 2, 60); // count 3
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(5); // ceil(5000ms)
    expect(calls[0]).toBe("https://example.upstash.io/pipeline");
  });
});

describe("createRateLimiter", () => {
  it("uses Upstash when configured, else memory", () => {
    expect(createRateLimiter(config)).toBeInstanceOf(MemoryRateLimiter);
    const upstash = createRateLimiter({
      ...config,
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    } as AppConfig);
    expect(upstash).toBeInstanceOf(UpstashRateLimiter);
  });
});

describe("gateway per-tenant rate limiting", () => {
  it("returns 429 with Retry-After after the per-tenant budget is spent", async () => {
    const app = buildApp({
      config,
      rateLimiter: new MemoryRateLimiter(() => 1_000),
      limitFor: () => 2, // tiny budget for the test
    });
    const auth = { authorization: `Bearer ${await token(TENANT_A)}` };

    const r1 = await app.inject({ method: "GET", url: "/whoami", headers: auth });
    expect(r1.statusCode).toBe(200);
    expect(r1.headers["ratelimit-limit"]).toBe("2");
    expect(r1.headers["ratelimit-remaining"]).toBe("1");

    const r2 = await app.inject({ method: "GET", url: "/whoami", headers: auth });
    expect(r2.statusCode).toBe(200);
    expect(r2.headers["ratelimit-remaining"]).toBe("0");

    const r3 = await app.inject({ method: "GET", url: "/whoami", headers: auth });
    expect(r3.statusCode).toBe(429);
    expect(r3.json().error).toBe("rate_limited");
    expect(r3.headers["retry-after"]).toBe("60");

    await app.close();
  });

  it("budgets are per tenant — one tenant cannot exhaust another", async () => {
    const app = buildApp({
      config,
      rateLimiter: new MemoryRateLimiter(() => 1_000),
      limitFor: () => 1,
    });
    const authA = { authorization: `Bearer ${await token(TENANT_A)}` };
    const authB = { authorization: `Bearer ${await token(TENANT_B)}` };

    expect(
      (await app.inject({ method: "GET", url: "/whoami", headers: authA }))
        .statusCode,
    ).toBe(200);
    // Tenant A is now over budget…
    expect(
      (await app.inject({ method: "GET", url: "/whoami", headers: authA }))
        .statusCode,
    ).toBe(429);
    // …but tenant B still has its own full budget.
    expect(
      (await app.inject({ method: "GET", url: "/whoami", headers: authB }))
        .statusCode,
    ).toBe(200);

    await app.close();
  });

  it("does not rate-limit the public /health probe", async () => {
    const app = buildApp({
      config,
      rateLimiter: new MemoryRateLimiter(() => 1_000),
      limitFor: () => 1,
    });
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });
});
