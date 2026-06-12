import { describe, it, expect, beforeAll } from "vitest";

import { buildApp } from "./main.js";

/**
 * Smoke test for the identity service health contract.
 * Demonstrates the testing pattern every service can follow: build the app via
 * the `buildApp()` factory and exercise routes with Fastify's `inject` (no port
 * binding, no network). Replicate this file per service as domain routes land.
 */
describe("identity service", () => {
  beforeAll(() => {
    // Minimum env the shared config schema requires (see @lms/config).
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/lms_test";
    process.env.JWT_SECRET ??= "test-secret-at-least-16-chars";
  });

  it("GET /health reports the service as ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe("identity");
    expect(body.status).toBe("ok");
    expect(["pool", "silo", "hybrid"]).toContain(body.tenantMode);

    await app.close();
  });
});
