import type { TenantContext } from "@lms/types";

/** A grade scheme maps a final percentage to a symbol (e.g. letter grade). */
export interface GradeSchemeRecord {
  id: string;
  tenantId: string;
  name: string;
  /** Ordered ranges, e.g. `[{ symbol: "A", min: 90 }, ...]`. */
  ranges: SchemeRange[];
}

export interface SchemeRange {
  symbol: string;
  /** Inclusive lower bound, as a percentage (0-100). */
  min: number;
}

/** A weighted bucket of grade items within a course. */
export interface GradeCategoryRecord {
  id: string;
  tenantId: string;
  courseId: string;
  name: string;
  /** Category weight as a percentage of the final grade (e.g. 40). */
  weight: number | null;
  position: number;
}

export type GradeItemSource = "quiz" | "assignment" | "manual";

/** A gradable column (line item) in a course gradebook. */
export interface GradeItemRecord {
  id: string;
  tenantId: string;
  courseId: string;
  categoryId: string | null;
  schemeId: string | null;
  name: string;
  maxPoints: number;
  weight: number | null;
  sourceType: GradeItemSource | null;
  sourceId: string | null;
  position: number;
}

/** A single user's score on a grade item. */
export interface GradeRecord {
  id: string;
  tenantId: string;
  gradeItemId: string;
  userId: string;
  points: number | null;
  feedback: string | null;
  isReleased: boolean;
  gradedBy: string | null;
  gradedAt: string | null;
  updatedAt: string;
}

export interface NewSchemeInput {
  name: string;
  ranges: SchemeRange[];
}

export interface NewCategoryInput {
  name: string;
  weight?: number | null;
  position?: number;
}

export interface NewItemInput {
  name: string;
  maxPoints?: number;
  weight?: number | null;
  categoryId?: string | null;
  schemeId?: string | null;
  sourceType?: GradeItemSource | null;
  sourceId?: string | null;
  position?: number;
}

export interface GradeInput {
  points: number | null;
  feedback?: string | null;
  isReleased?: boolean;
  gradedBy?: string | null;
}

export type UpsertGradeResult =
  | { ok: true; grade: GradeRecord }
  | { ok: false; reason: "unknown_item" };

/** Full gradebook matrix for a course: the columns and every cell. */
export interface Gradebook {
  courseId: string;
  categories: GradeCategoryRecord[];
  items: GradeItemRecord[];
  grades: GradeRecord[];
}

/** A computed final grade for one user in a course. */
export interface FinalGrade {
  userId: string;
  /** Final score as a percentage (0-100), rounded to 2 decimals. */
  percent: number;
  /** Symbol from the applied grade scheme, when one resolves. */
  symbol: string | null;
  /** Number of graded items that contributed to the calculation. */
  gradedItems: number;
}

/**
 * Persistence boundary for the grading (gradebook) service. Routes depend only
 * on this interface, so production uses an RLS-scoped Postgres implementation
 * while tests inject an in-memory one — mirroring the course/enrollment/
 * attendance services.
 */
export interface GradingStore {
  createScheme(
    ctx: TenantContext,
    input: NewSchemeInput,
  ): Promise<GradeSchemeRecord>;
  listSchemes(ctx: TenantContext): Promise<GradeSchemeRecord[]>;

  createCategory(
    ctx: TenantContext,
    courseId: string,
    input: NewCategoryInput,
  ): Promise<GradeCategoryRecord>;
  listCategories(
    ctx: TenantContext,
    courseId: string,
  ): Promise<GradeCategoryRecord[]>;

  createItem(
    ctx: TenantContext,
    courseId: string,
    input: NewItemInput,
  ): Promise<GradeItemRecord>;
  getItem(ctx: TenantContext, id: string): Promise<GradeItemRecord | null>;
  listItems(
    ctx: TenantContext,
    courseId: string,
  ): Promise<GradeItemRecord[]>;

  /** Enter or override a user's grade on an item (upsert). */
  upsertGrade(
    ctx: TenantContext,
    itemId: string,
    userId: string,
    input: GradeInput,
  ): Promise<UpsertGradeResult>;

  /** Release every grade in a course (bulk release). Returns the count. */
  releaseCourseGrades(
    ctx: TenantContext,
    courseId: string,
  ): Promise<number>;

  /** Full matrix of categories, items and grades for a course. */
  getGradebook(ctx: TenantContext, courseId: string): Promise<Gradebook>;

  /** All grades for one user in a course (used for the student grade view). */
  listGradesForUser(
    ctx: TenantContext,
    courseId: string,
    userId: string,
  ): Promise<GradeRecord[]>;

  /** AGS line items (optionally scoped to a course) for LTI tools. */
  listLineItems(
    ctx: TenantContext,
    courseId?: string,
  ): Promise<GradeItemRecord[]>;
}

/** Resolve a percentage to a scheme symbol, or null when none matches. */
export function symbolForPercent(
  ranges: SchemeRange[] | undefined,
  percent: number,
): string | null {
  if (!ranges || ranges.length === 0) return null;
  const sorted = [...ranges].sort((a, b) => b.min - a.min);
  for (const range of sorted) {
    if (percent >= range.min) return range.symbol;
  }
  return null;
}

/**
 * Compute final grades from a gradebook. Pure so both store implementations and
 * tests share one algorithm.
 *
 * - When categories carry weights, the final grade is the weighted average of
 *   each category's percentage (points earned / points possible over the graded
 *   items in that category), normalised by the weights of the categories the
 *   user actually has grades in. Uncategorised items are ignored in this mode.
 * - Otherwise it is the simple points-based percentage across all graded items.
 *
 * Only items with a non-null `points` grade contribute.
 */
export function computeFinalGrades(
  gradebook: Gradebook,
  scheme?: GradeSchemeRecord,
): FinalGrade[] {
  const { categories, items, grades } = gradebook;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const weightedCategories = categories.filter(
    (c) => typeof c.weight === "number" && c.weight > 0,
  );
  const useWeighted = weightedCategories.length > 0;

  const userIds = [
    ...new Set(
      grades
        .filter((g) => g.points !== null && itemById.has(g.gradeItemId))
        .map((g) => g.userId),
    ),
  ].sort();

  const results: FinalGrade[] = [];
  for (const userId of userIds) {
    const userGrades = grades.filter(
      (g) =>
        g.userId === userId && g.points !== null && itemById.has(g.gradeItemId),
    );
    if (userGrades.length === 0) continue;

    let percent: number;
    if (useWeighted) {
      let weightedSum = 0;
      let weightTotal = 0;
      for (const category of weightedCategories) {
        const catGrades = userGrades.filter(
          (g) => itemById.get(g.gradeItemId)!.categoryId === category.id,
        );
        if (catGrades.length === 0) continue;
        let earned = 0;
        let possible = 0;
        for (const g of catGrades) {
          earned += g.points!;
          possible += itemById.get(g.gradeItemId)!.maxPoints;
        }
        if (possible <= 0) continue;
        weightedSum += (earned / possible) * category.weight!;
        weightTotal += category.weight!;
      }
      percent = weightTotal > 0 ? (weightedSum / weightTotal) * 100 : 0;
    } else {
      let earned = 0;
      let possible = 0;
      for (const g of userGrades) {
        earned += g.points!;
        possible += itemById.get(g.gradeItemId)!.maxPoints;
      }
      percent = possible > 0 ? (earned / possible) * 100 : 0;
    }

    const rounded = Math.round(percent * 100) / 100;
    results.push({
      userId,
      percent: rounded,
      symbol: symbolForPercent(scheme?.ranges, rounded),
      gradedItems: userGrades.length,
    });
  }
  return results;
}
