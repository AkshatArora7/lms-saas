import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemoryRubricStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};
const OTHER_TENANT: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER_TENANT.tenantId ? OTHER_TENANT : TENANT;
}

function buildTestApp(store = new MemoryRubricStore()) {
  return buildApp({ config, store, resolveTenant });
}

const H = { "x-tenant-id": DEMO_TENANT_ID };
const OTHER_H = { "x-tenant-id": OTHER_TENANT.tenantId };

const SAMPLE_RUBRIC = {
  name: "Essay rubric",
  kind: "analytic",
  criteria: [
    {
      name: "Thesis",
      levels: [
        { label: "Exemplary", points: 4 },
        { label: "Proficient", points: 3 },
        { label: "Developing", points: 1 },
      ],
    },
    {
      name: "Evidence",
      levels: [
        { label: "Exemplary", points: 4 },
        { label: "Developing", points: 2 },
      ],
    },
  ],
};

async function createRubric(
  app: ReturnType<typeof buildTestApp>,
  payload: Record<string, unknown> = SAMPLE_RUBRIC,
  headers = H,
) {
  return app.inject({ method: "POST", url: "/rubrics", headers, payload });
}

describe("rubric service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "rubric", status: "ok" });
  });

  it("400s without a tenant", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/rubrics" });
    expect(res.statusCode).toBe(400);
  });
});

describe("rubrics (story #49)", () => {
  it("creates an analytic rubric with criteria and levels", async () => {
    const app = buildTestApp();
    const res = await createRubric(app);
    expect(res.statusCode).toBe(201);
    const rubric = res.json().rubric;
    expect(rubric.kind).toBe("analytic");
    expect(rubric.criteria).toHaveLength(2);
    expect(rubric.criteria[0].levels).toHaveLength(3);
  });

  it("validates name, kind and level points", async () => {
    const app = buildTestApp();
    expect((await createRubric(app, { criteria: [] })).statusCode).toBe(400);
    expect(
      (await createRubric(app, { name: "X", kind: "weird" })).statusCode,
    ).toBe(400);
    expect(
      (
        await createRubric(app, {
          name: "X",
          criteria: [{ name: "C", levels: [{ label: "L" }] }],
        })
      ).statusCode,
    ).toBe(400);
  });

  it("fetches and lists rubrics; 404 for missing", async () => {
    const app = buildTestApp();
    const id = (await createRubric(app)).json().rubric.id;
    const got = await app.inject({ method: "GET", url: `/rubrics/${id}`, headers: H });
    expect(got.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/rubrics", headers: H });
    expect(list.json().rubrics).toHaveLength(1);
    const missing = await app.inject({
      method: "GET",
      url: "/rubrics/99999999-9999-9999-9999-999999999999",
      headers: H,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("adds a criterion to an existing rubric", async () => {
    const app = buildTestApp();
    const id = (await createRubric(app)).json().rubric.id;
    const res = await app.inject({
      method: "POST",
      url: `/rubrics/${id}/criteria`,
      headers: H,
      payload: { name: "Mechanics", levels: [{ label: "Clean", points: 2 }] },
    });
    expect(res.statusCode).toBe(201);
    const got = await app.inject({ method: "GET", url: `/rubrics/${id}`, headers: H });
    expect(got.json().rubric.criteria).toHaveLength(3);
  });

  it("scores a rubric (total/max) and rejects bad selections", async () => {
    const app = buildTestApp();
    const rubric = (await createRubric(app)).json().rubric;
    const [thesis, evidence] = rubric.criteria;

    const score = await app.inject({
      method: "POST",
      url: `/rubrics/${rubric.id}/score`,
      headers: H,
      payload: {
        selections: [
          { criterionId: thesis.id, levelId: thesis.levels[1].id }, // 3
          { criterionId: evidence.id, levelId: evidence.levels[0].id }, // 4
        ],
      },
    });
    expect(score.statusCode).toBe(200);
    expect(score.json().score).toMatchObject({ total: 7, max: 8 }); // max 4+4

    const bad = await app.inject({
      method: "POST",
      url: `/rubrics/${rubric.id}/score`,
      headers: H,
      payload: {
        selections: [{ criterionId: thesis.id, levelId: "not-a-level" }],
      },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("deletes a rubric", async () => {
    const app = buildTestApp();
    const id = (await createRubric(app)).json().rubric.id;
    expect(
      (await app.inject({ method: "DELETE", url: `/rubrics/${id}`, headers: H }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "DELETE", url: `/rubrics/${id}`, headers: H }))
        .statusCode,
    ).toBe(404);
  });
});

describe("competencies & outcomes (story #50)", () => {
  it("creates a competency tree, objectives, and aligns them to activities", async () => {
    const app = buildTestApp();
    const root = await app.inject({
      method: "POST",
      url: "/competencies",
      headers: H,
      payload: { name: "Writing" },
    });
    expect(root.statusCode).toBe(201);
    const rootId = root.json().competency.id;

    const child = await app.inject({
      method: "POST",
      url: "/competencies",
      headers: H,
      payload: { name: "Argumentation", parentId: rootId },
    });
    expect(child.json().competency.parentId).toBe(rootId);

    const badParent = await app.inject({
      method: "POST",
      url: "/competencies",
      headers: H,
      payload: { name: "Orphan", parentId: "99999999-9999-9999-9999-999999999999" },
    });
    expect(badParent.statusCode).toBe(400);

    const objective = await app.inject({
      method: "POST",
      url: "/objectives",
      headers: H,
      payload: { statement: "Construct a claim", competencyId: rootId, code: "W.1" },
    });
    expect(objective.statusCode).toBe(201);
    const objId = objective.json().objective.id;

    const align = await app.inject({
      method: "POST",
      url: `/objectives/${objId}/alignments`,
      headers: H,
      payload: { targetType: "assignment", targetId: "33333333-3333-3333-3333-333333333333" },
    });
    expect(align.statusCode).toBe(201);

    const badTarget = await app.inject({
      method: "POST",
      url: `/objectives/${objId}/alignments`,
      headers: H,
      payload: { targetType: "spaceship", targetId: "x" },
    });
    expect(badTarget.statusCode).toBe(400);

    // Reverse lookup: which objectives align to the activity?
    const forActivity = await app.inject({
      method: "GET",
      url: "/activities/assignment/33333333-3333-3333-3333-333333333333/objectives",
      headers: H,
    });
    expect(forActivity.json().objectives).toHaveLength(1);
    expect(forActivity.json().objectives[0].id).toBe(objId);
  });

  it("404s aligning to a missing objective", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/objectives/99999999-9999-9999-9999-999999999999/alignments",
      headers: H,
      payload: { targetType: "quiz", targetId: "44444444-4444-4444-4444-444444444444" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("tenant isolation", () => {
  it("never returns another tenant's rubrics or competencies", async () => {
    const app = buildTestApp();
    const id = (await createRubric(app)).json().rubric.id;
    await app.inject({
      method: "POST",
      url: "/competencies",
      headers: H,
      payload: { name: "Writing" },
    });

    expect(
      (await app.inject({ method: "GET", url: "/rubrics", headers: OTHER_H }))
        .json().rubrics,
    ).toHaveLength(0);
    expect(
      (await app.inject({ method: "GET", url: "/competencies", headers: OTHER_H }))
        .json().competencies,
    ).toHaveLength(0);
    expect(
      (await app.inject({ method: "GET", url: `/rubrics/${id}`, headers: OTHER_H }))
        .statusCode,
    ).toBe(404);
  });
});
