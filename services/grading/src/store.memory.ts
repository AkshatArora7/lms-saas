import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  GradeCategoryRecord,
  GradeInput,
  GradeItemRecord,
  GradeRecord,
  GradeSchemeRecord,
  Gradebook,
  GradingStore,
  NewCategoryInput,
  NewItemInput,
  NewSchemeInput,
  UpsertGradeResult,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory GradingStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `GRADING_STORE=memory`.
 */
export class MemoryGradingStore implements GradingStore {
  private schemes: GradeSchemeRecord[] = [];
  private categories: GradeCategoryRecord[] = [];
  private items: GradeItemRecord[] = [];
  private grades: GradeRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  seedScheme(scheme: GradeSchemeRecord): void {
    this.schemes.push(scheme);
  }
  seedCategory(category: GradeCategoryRecord): void {
    this.categories.push(category);
  }
  seedItem(item: GradeItemRecord): void {
    this.items.push(item);
  }
  seedGrade(grade: GradeRecord): void {
    this.grades.push(grade);
  }

  async createScheme(
    ctx: TenantContext,
    input: NewSchemeInput,
  ): Promise<GradeSchemeRecord> {
    const scheme: GradeSchemeRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      name: input.name,
      ranges: input.ranges,
    };
    this.schemes.push(scheme);
    return scheme;
  }

  async listSchemes(ctx: TenantContext): Promise<GradeSchemeRecord[]> {
    return this.schemes.filter((s) => s.tenantId === ctx.tenantId);
  }

  async createCategory(
    ctx: TenantContext,
    courseId: string,
    input: NewCategoryInput,
  ): Promise<GradeCategoryRecord> {
    const category: GradeCategoryRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId,
      name: input.name,
      weight: input.weight ?? null,
      position: input.position ?? this.nextCategoryPosition(ctx, courseId),
    };
    this.categories.push(category);
    return category;
  }

  private nextCategoryPosition(ctx: TenantContext, courseId: string): number {
    const existing = this.categories.filter(
      (c) => c.tenantId === ctx.tenantId && c.courseId === courseId,
    );
    return existing.length;
  }

  async listCategories(
    ctx: TenantContext,
    courseId: string,
  ): Promise<GradeCategoryRecord[]> {
    return this.categories
      .filter((c) => c.tenantId === ctx.tenantId && c.courseId === courseId)
      .sort((a, b) => a.position - b.position);
  }

  async createItem(
    ctx: TenantContext,
    courseId: string,
    input: NewItemInput,
  ): Promise<GradeItemRecord> {
    const item: GradeItemRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId,
      categoryId: input.categoryId ?? null,
      schemeId: input.schemeId ?? null,
      name: input.name,
      maxPoints: input.maxPoints ?? 100,
      weight: input.weight ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      position: input.position ?? this.nextItemPosition(ctx, courseId),
    };
    this.items.push(item);
    return item;
  }

  private nextItemPosition(ctx: TenantContext, courseId: string): number {
    return this.items.filter(
      (i) => i.tenantId === ctx.tenantId && i.courseId === courseId,
    ).length;
  }

  async getItem(
    ctx: TenantContext,
    id: string,
  ): Promise<GradeItemRecord | null> {
    return (
      this.items.find((i) => i.id === id && i.tenantId === ctx.tenantId) ?? null
    );
  }

  async listItems(
    ctx: TenantContext,
    courseId: string,
  ): Promise<GradeItemRecord[]> {
    return this.items
      .filter((i) => i.tenantId === ctx.tenantId && i.courseId === courseId)
      .sort((a, b) => a.position - b.position);
  }

  async upsertGrade(
    ctx: TenantContext,
    itemId: string,
    userId: string,
    input: GradeInput,
  ): Promise<UpsertGradeResult> {
    const item = this.items.find(
      (i) => i.id === itemId && i.tenantId === ctx.tenantId,
    );
    if (!item) return { ok: false, reason: "unknown_item" };

    const nowIso = this.now().toISOString();
    const existing = this.grades.find(
      (g) =>
        g.tenantId === ctx.tenantId &&
        g.gradeItemId === itemId &&
        g.userId === userId,
    );
    if (existing) {
      existing.points = input.points;
      existing.feedback = input.feedback ?? null;
      if (input.isReleased !== undefined) existing.isReleased = input.isReleased;
      existing.gradedBy = input.gradedBy ?? null;
      existing.gradedAt = nowIso;
      existing.updatedAt = nowIso;
      return { ok: true, grade: existing };
    }

    const grade: GradeRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      gradeItemId: itemId,
      userId,
      points: input.points,
      feedback: input.feedback ?? null,
      isReleased: input.isReleased ?? false,
      gradedBy: input.gradedBy ?? null,
      gradedAt: nowIso,
      updatedAt: nowIso,
    };
    this.grades.push(grade);
    return { ok: true, grade };
  }

  async releaseCourseGrades(
    ctx: TenantContext,
    courseId: string,
  ): Promise<number> {
    const itemIds = new Set(
      this.items
        .filter((i) => i.tenantId === ctx.tenantId && i.courseId === courseId)
        .map((i) => i.id),
    );
    let count = 0;
    for (const g of this.grades) {
      if (
        g.tenantId === ctx.tenantId &&
        itemIds.has(g.gradeItemId) &&
        !g.isReleased
      ) {
        g.isReleased = true;
        count += 1;
      }
    }
    return count;
  }

  async getGradebook(
    ctx: TenantContext,
    courseId: string,
  ): Promise<Gradebook> {
    const categories = await this.listCategories(ctx, courseId);
    const items = await this.listItems(ctx, courseId);
    const itemIds = new Set(items.map((i) => i.id));
    const grades = this.grades.filter(
      (g) => g.tenantId === ctx.tenantId && itemIds.has(g.gradeItemId),
    );
    return { courseId, categories, items, grades };
  }

  async listGradesForUser(
    ctx: TenantContext,
    courseId: string,
    userId: string,
  ): Promise<GradeRecord[]> {
    const itemIds = new Set(
      this.items
        .filter((i) => i.tenantId === ctx.tenantId && i.courseId === courseId)
        .map((i) => i.id),
    );
    return this.grades.filter(
      (g) =>
        g.tenantId === ctx.tenantId &&
        g.userId === userId &&
        itemIds.has(g.gradeItemId),
    );
  }

  async listLineItems(
    ctx: TenantContext,
    courseId?: string,
  ): Promise<GradeItemRecord[]> {
    return this.items.filter(
      (i) =>
        i.tenantId === ctx.tenantId &&
        (courseId === undefined || i.courseId === courseId),
    );
  }
}

/** Build a MemoryGradingStore pre-seeded with a demo course gradebook. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryGradingStore {
  const store = new MemoryGradingStore(generateId, now);
  const scheme: GradeSchemeRecord = {
    id: "demo-scheme-1",
    tenantId: DEMO_TENANT_ID,
    name: "Standard Letter",
    ranges: [
      { symbol: "A", min: 90 },
      { symbol: "B", min: 80 },
      { symbol: "C", min: 70 },
      { symbol: "D", min: 60 },
      { symbol: "F", min: 0 },
    ],
  };
  store.seedScheme(scheme);
  store.seedCategory({
    id: "demo-cat-1",
    tenantId: DEMO_TENANT_ID,
    courseId: "demo-course",
    name: "Assignments",
    weight: 100,
    position: 0,
  });
  store.seedItem({
    id: "demo-item-1",
    tenantId: DEMO_TENANT_ID,
    courseId: "demo-course",
    categoryId: "demo-cat-1",
    schemeId: "demo-scheme-1",
    name: "Essay 1",
    maxPoints: 100,
    weight: null,
    sourceType: "manual",
    sourceId: null,
    position: 0,
  });
  store.seedGrade({
    id: "demo-grade-1",
    tenantId: DEMO_TENANT_ID,
    gradeItemId: "demo-item-1",
    userId: "demo-student",
    points: 95,
    feedback: "Great work.",
    isReleased: true,
    gradedBy: "demo-instructor",
    gradedAt: new Date("2026-01-02T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-02T00:00:00.000Z").toISOString(),
  });
  return store;
}
