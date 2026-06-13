import { beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./main.js";

/**
 * Smoke test for the attendance service health contract. Domain routes
 * (codes, sessions, records, summaries) are added per the service spec.
 */
describe("attendance service", () => {
  beforeAll(() => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/lms_test";
    process.env.JWT_SECRET ??= "test-secret-at-least-16-chars";
  });

  it("GET /health reports the service as ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe("attendance");
    expect(body.status).toBe("ok");
    expect(["pool", "silo", "hybrid"]).toContain(body.tenantMode);

    await app.close();
  });
});
