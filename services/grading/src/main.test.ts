import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryGradingStore,
} from "./store.memory.js";

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

function buildTestApp(store = new MemoryGradingStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

type App = ReturnType<typeof buildTestApp>;

async function createItem(
  app: App,
  courseId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/courses/${courseId}/grade-items`,
    headers: HEADERS,
    payload,
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { item: { id: string } }).item.id;
}

async function putGrade(
  app: App,
  itemId: string,
  userId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "PUT",
    url: `/grade-items/${itemId}/grades/${userId}`,
    headers: HEADERS,
    payload,
  });
}

describe("grading service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "grading", status: "ok" });
  });
});

describe("grade items and grades", () => {
  it("creates a line item (201) and lists it", async () => {
    const app = buildTestApp();
    await createItem(app, "course-1", { name: "Quiz 1", maxPoints: 50 });
    const list = await app.inject({
      method: "GET",
      url: "/courses/course-1/grade-items",
      headers: HEADERS,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it("rejects an item without a name (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/courses/course-1/grade-items",
      headers: HEADERS,
      payload: { maxPoints: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enters then overrides a grade (200, upsert)", async () => {
    const app = buildTestApp();
    const itemId = await createItem(app, "course-1", {
      name: "Essay",
      maxPoints: 100,
    });

    const first = await putGrade(app, itemId, "stu-1", {
      points: 80,
      feedback: "Good",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ grade: { points: 80 } });

    const override = await putGrade(app, itemId, "stu-1", { points: 90 });
    expect(override.statusCode).toBe(200);
    expect(override.json()).toMatchObject({ grade: { points: 90 } });

    // Still a single grade cell for this (item, user).
    const gb = await app.inject({
      method: "GET",
      url: "/courses/course-1/gradebook",
      headers: HEADERS,
    });
    expect(
      (gb.json() as { gradebook: { grades: unknown[] } }).gradebook.grades,
    ).toHaveLength(1);
  });

  it("returns 404 grading an unknown item", async () => {
    const app = buildTestApp();
    const res = await putGrade(app, "missing-item", "stu-1", { points: 10 });
    expect(res.statusCode).toBe(404);
  });
});

describe("gradebook matrix and final grades", () => {
  it("computes a simple points-based final grade", async () => {
    const app = buildTestApp();
    const i1 = await createItem(app, "c2", { name: "A", maxPoints: 100 });
    const i2 = await createItem(app, "c2", { name: "B", maxPoints: 100 });
    await putGrade(app, i1, "stu-1", { points: 80 });
    await putGrade(app, i2, "stu-1", { points: 100 });

    const res = await app.inject({
      method: "POST",
      url: "/courses/c2/final-grades/calculate",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const { finalGrades } = res.json() as {
      finalGrades: { userId: string; percent: number }[];
    };
    expect(finalGrades).toHaveLength(1);
    expect(finalGrades[0]).toMatchObject({ userId: "stu-1", percent: 90 });
  });

  it("computes a weighted final grade across categories", async () => {
    const app = buildTestApp();
    const catRes = async (name: string, weight: number) =>
      (
        await app.inject({
          method: "POST",
          url: "/courses/c3/grade-categories",
          headers: HEADERS,
          payload: { name, weight },
        })
      ).json() as { category: { id: string } };

    const exams = (await catRes("Exams", 70)).category.id;
    const homework = (await catRes("Homework", 30)).category.id;

    const exam = await createItem(app, "c3", {
      name: "Final Exam",
      maxPoints: 100,
      categoryId: exams,
    });
    const hw = await createItem(app, "c3", {
      name: "HW1",
      maxPoints: 100,
      categoryId: homework,
    });
    await putGrade(app, exam, "stu-1", { points: 60 }); // 60% * 70
    await putGrade(app, hw, "stu-1", { points: 100 }); // 100% * 30

    const res = await app.inject({
      method: "POST",
      url: "/courses/c3/final-grades/calculate",
      headers: HEADERS,
    });
    const { finalGrades } = res.json() as {
      finalGrades: { percent: number }[];
    };
    // (0.6*70 + 1.0*30) / 100 * 100 = 72
    expect(finalGrades[0]!.percent).toBe(72);
  });

  it("maps a final grade to a scheme symbol", async () => {
    const app = buildTestApp();
    const schemeRes = await app.inject({
      method: "POST",
      url: "/schemes",
      headers: HEADERS,
      payload: {
        name: "Letters",
        ranges: [
          { symbol: "A", min: 90 },
          { symbol: "B", min: 80 },
          { symbol: "F", min: 0 },
        ],
      },
    });
    const schemeId = (schemeRes.json() as { scheme: { id: string } }).scheme.id;

    const item = await createItem(app, "c4", { name: "T", maxPoints: 100 });
    await putGrade(app, item, "stu-1", { points: 95 });

    const res = await app.inject({
      method: "POST",
      url: `/courses/c4/final-grades/calculate?schemeId=${schemeId}`,
      headers: HEADERS,
    });
    const { finalGrades } = res.json() as {
      finalGrades: { symbol: string | null }[];
    };
    expect(finalGrades[0]!.symbol).toBe("A");
  });
});

describe("release and student view", () => {
  it("hides unreleased grades from the student view until bulk release", async () => {
    const app = buildTestApp();
    const item = await createItem(app, "c5", { name: "T", maxPoints: 100 });
    await putGrade(app, item, "stu-1", { points: 88 });

    const before = await app.inject({
      method: "GET",
      url: "/courses/c5/students/stu-1/grades",
      headers: HEADERS,
    });
    expect((before.json() as { grades: unknown[] }).grades).toHaveLength(0);

    const release = await app.inject({
      method: "POST",
      url: "/courses/c5/grades/release",
      headers: HEADERS,
    });
    expect(release.json()).toMatchObject({ released: 1 });

    const after = await app.inject({
      method: "GET",
      url: "/courses/c5/students/stu-1/grades",
      headers: HEADERS,
    });
    expect((after.json() as { grades: unknown[] }).grades).toHaveLength(1);
    expect(
      (after.json() as { projected: { percent: number } }).projected.percent,
    ).toBe(88);
  });
});

describe("LTI AGS and tenant isolation", () => {
  it("exposes AGS line items for a course", async () => {
    const app = buildTestApp();
    await createItem(app, "c6", {
      name: "Quiz",
      maxPoints: 20,
      sourceType: "quiz",
    });
    const res = await app.inject({
      method: "GET",
      url: "/lti/ags/lineitems?courseId=c6",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const { lineItems } = res.json() as {
      lineItems: { label: string; scoreMaximum: number }[];
    };
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]).toMatchObject({ label: "Quiz", scoreMaximum: 20 });
  });

  it("isolates gradebooks across tenants", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const ours = await app.inject({
      method: "GET",
      url: "/courses/demo-course/gradebook",
      headers: HEADERS,
    });
    expect(
      (ours.json() as { gradebook: { items: unknown[] } }).gradebook.items,
    ).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: "/courses/demo-course/gradebook",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect(
      (theirs.json() as { gradebook: { items: unknown[] } }).gradebook.items,
    ).toEqual([]);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/courses/c1/gradebook",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
