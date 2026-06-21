import { withTenant } from "@lms/db";

import type {
  GradeCategoryRecord,
  GradeInput,
  GradeItemRecord,
  GradeItemSource,
  GradeRecord,
  GradeSchemeRecord,
  Gradebook,
  GradingStore,
  NewCategoryInput,
  NewItemInput,
  NewSchemeInput,
  SchemeRange,
  UpsertGradeResult,
} from "./store.js";

interface SchemeRow {
  id: string;
  tenant_id: string;
  name: string;
  ranges: unknown;
}

interface CategoryRow {
  id: string;
  tenant_id: string;
  course_id: string;
  name: string;
  weight: number | string | null;
  position: number;
}

interface ItemRow {
  id: string;
  tenant_id: string;
  course_id: string;
  category_id: string | null;
  scheme_id: string | null;
  name: string;
  max_points: number | string;
  weight: number | string | null;
  source_type: GradeItemSource | null;
  source_id: string | null;
  position: number;
}

interface GradeRow {
  id: string;
  tenant_id: string;
  grade_item_id: string;
  user_id: string;
  points: number | string | null;
  feedback: string | null;
  is_released: boolean;
  graded_by: string | null;
  graded_at: Date | string | null;
  updated_at: Date | string;
}

function num(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : Number(value);
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toScheme(row: SchemeRow): GradeSchemeRecord {
  const ranges = Array.isArray(row.ranges)
    ? (row.ranges as SchemeRange[])
    : typeof row.ranges === "string"
      ? (JSON.parse(row.ranges) as SchemeRange[])
      : [];
  return { id: row.id, tenantId: row.tenant_id, name: row.name, ranges };
}

function toCategory(row: CategoryRow): GradeCategoryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    courseId: row.course_id,
    name: row.name,
    weight: num(row.weight),
    position: row.position,
  };
}

function toItem(row: ItemRow): GradeItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    courseId: row.course_id,
    categoryId: row.category_id,
    schemeId: row.scheme_id,
    name: row.name,
    maxPoints: num(row.max_points) ?? 0,
    weight: num(row.weight),
    sourceType: row.source_type,
    sourceId: row.source_id,
    position: row.position,
  };
}

function toGrade(row: GradeRow): GradeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    gradeItemId: row.grade_item_id,
    userId: row.user_id,
    points: num(row.points),
    feedback: row.feedback,
    isReleased: row.is_released,
    gradedBy: row.graded_by,
    gradedAt: iso(row.graded_at),
    updatedAt: iso(row.updated_at) ?? "",
  };
}

const SELECT_ITEM = `
  SELECT id, tenant_id, course_id, category_id, scheme_id, name,
         max_points, weight, source_type, source_id, position
    FROM grade_item`;

const SELECT_GRADE = `
  SELECT id, tenant_id, grade_item_id, user_id, points, feedback,
         is_released, graded_by, graded_at, updated_at
    FROM grade`;

/**
 * Postgres-backed grading store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants.
 */
export function createPrismaStore(): GradingStore {
  return {
    async createScheme(ctx, input: NewSchemeInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<SchemeRow[]>(
          `INSERT INTO grade_scheme (tenant_id, name, ranges)
           VALUES ($1::uuid, $2, $3::jsonb)
           RETURNING id, tenant_id, name, ranges`,
          ctx.tenantId,
          input.name,
          JSON.stringify(input.ranges),
        );
        return toScheme(rows[0]!);
      });
    },

    async listSchemes(ctx) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<SchemeRow[]>(
          `SELECT id, tenant_id, name, ranges FROM grade_scheme ORDER BY name`,
        );
        return rows.map(toScheme);
      });
    },

    async createCategory(ctx, courseId, input: NewCategoryInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CategoryRow[]>(
          `INSERT INTO grade_category (tenant_id, course_id, name, weight, position)
           VALUES (
             $1::uuid, $2::uuid, $3, $4,
             COALESCE($5, (SELECT COUNT(*)::int FROM grade_category
                            WHERE course_id = $2::uuid))
           )
           RETURNING id, tenant_id, course_id, name, weight, position`,
          ctx.tenantId,
          courseId,
          input.name,
          input.weight ?? null,
          input.position ?? null,
        );
        return toCategory(rows[0]!);
      });
    },

    async listCategories(ctx, courseId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CategoryRow[]>(
          `SELECT id, tenant_id, course_id, name, weight, position
             FROM grade_category WHERE course_id = $1::uuid ORDER BY position`,
          courseId,
        );
        return rows.map(toCategory);
      });
    },

    async createItem(ctx, courseId, input: NewItemInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ItemRow[]>(
          `INSERT INTO grade_item
             (tenant_id, course_id, category_id, scheme_id, name,
              max_points, weight, source_type, source_id, position)
           VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::uuid,
             COALESCE($10, (SELECT COUNT(*)::int FROM grade_item
                             WHERE course_id = $2::uuid))
           )
           RETURNING id, tenant_id, course_id, category_id, scheme_id, name,
                     max_points, weight, source_type, source_id, position`,
          ctx.tenantId,
          courseId,
          input.categoryId ?? null,
          input.schemeId ?? null,
          input.name,
          input.maxPoints ?? 100,
          input.weight ?? null,
          input.sourceType ?? null,
          input.sourceId ?? null,
          input.position ?? null,
        );
        return toItem(rows[0]!);
      });
    },

    async getItem(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ItemRow[]>(
          `${SELECT_ITEM} WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toItem(rows[0]) : null;
      });
    },

    async listItems(ctx, courseId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ItemRow[]>(
          `${SELECT_ITEM} WHERE course_id = $1::uuid ORDER BY position`,
          courseId,
        );
        return rows.map(toItem);
      });
    },

    async upsertGrade(ctx, itemId, userId, input: GradeInput) {
      return withTenant<UpsertGradeResult>(ctx, async (db) => {
        const itemRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM grade_item WHERE id = $1::uuid LIMIT 1`,
          itemId,
        );
        if (itemRows.length === 0) {
          return { ok: false, reason: "unknown_item" };
        }
        const rows = await db.$queryRawUnsafe<GradeRow[]>(
          `INSERT INTO grade
             (tenant_id, grade_item_id, user_id, points, feedback,
              is_released, graded_by, graded_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid, now())
           ON CONFLICT (grade_item_id, user_id) DO UPDATE SET
             points = EXCLUDED.points,
             feedback = EXCLUDED.feedback,
             is_released = CASE WHEN $8 THEN EXCLUDED.is_released
                                ELSE grade.is_released END,
             graded_by = EXCLUDED.graded_by,
             graded_at = now(),
             updated_at = now()
           RETURNING id, tenant_id, grade_item_id, user_id, points, feedback,
                     is_released, graded_by, graded_at, updated_at`,
          ctx.tenantId,
          itemId,
          userId,
          input.points,
          input.feedback ?? null,
          input.isReleased ?? false,
          input.gradedBy ?? null,
          input.isReleased !== undefined,
        );
        return { ok: true, grade: toGrade(rows[0]!) };
      });
    },

    async releaseCourseGrades(ctx, courseId) {
      return withTenant(ctx, async (db) => {
        const updated = await db.$executeRawUnsafe(
          `UPDATE grade SET is_released = true, updated_at = now()
            WHERE is_released = false
              AND grade_item_id IN (
                SELECT id FROM grade_item WHERE course_id = $1::uuid)`,
          courseId,
        );
        return updated;
      });
    },

    async getGradebook(ctx, courseId): Promise<Gradebook> {
      return withTenant(ctx, async (db) => {
        const categoryRows = await db.$queryRawUnsafe<CategoryRow[]>(
          `SELECT id, tenant_id, course_id, name, weight, position
             FROM grade_category WHERE course_id = $1::uuid ORDER BY position`,
          courseId,
        );
        const itemRows = await db.$queryRawUnsafe<ItemRow[]>(
          `${SELECT_ITEM} WHERE course_id = $1::uuid ORDER BY position`,
          courseId,
        );
        const gradeRows = await db.$queryRawUnsafe<GradeRow[]>(
          `${SELECT_GRADE}
            WHERE grade_item_id IN (
              SELECT id FROM grade_item WHERE course_id = $1::uuid)`,
          courseId,
        );
        return {
          courseId,
          categories: categoryRows.map(toCategory),
          items: itemRows.map(toItem),
          grades: gradeRows.map(toGrade),
        };
      });
    },

    async listGradesForUser(ctx, courseId, userId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<GradeRow[]>(
          `${SELECT_GRADE}
            WHERE user_id = $1::uuid
              AND grade_item_id IN (
                SELECT id FROM grade_item WHERE course_id = $2::uuid)`,
          userId,
          courseId,
        );
        return rows.map(toGrade);
      });
    },

    async listLineItems(ctx, courseId?) {
      return withTenant(ctx, async (db) => {
        const rows =
          courseId === undefined
            ? await db.$queryRawUnsafe<ItemRow[]>(
                `${SELECT_ITEM} ORDER BY course_id, position`,
              )
            : await db.$queryRawUnsafe<ItemRow[]>(
                `${SELECT_ITEM} WHERE course_id = $1::uuid ORDER BY position`,
                courseId,
              );
        return rows.map(toItem);
      });
    },
  };
}
