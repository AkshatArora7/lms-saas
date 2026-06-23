import { signAccessToken } from "@lms/auth";
import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { MemoryRateLimiter } from "./ratelimit.js";

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
