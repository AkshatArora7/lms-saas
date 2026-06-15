import { randomUUID } from "node:crypto";

import { withTenant } from "@lms/db";

import type {
  CourseRecord,
  CourseStore,
  NewCourseInput,
  UpdateCourseInput,
} from "./store.js";

interface CourseRow {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  is_published: boolean;
  start_date: Date | null;
  end_date: Date | null;
}

function toRecord(row: CourseRow): CourseRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    isPublished: row.is_published,
    startDate: row.start_date ? row.start_date.toISOString() : null,
    endDate: row.end_date ? row.end_date.toISOString() : null,
  };
}

const SELECT_COLUMNS = `id, tenant_id, title, description, is_published, start_date, end_date`;

/**
 * Postgres-backed course store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants. Parameterised
 * raw SQL keeps this independent of the generated Prisma client surface.
 */
export function createPrismaStore(
  generateId: () => string = randomUUID,
): CourseStore {
  return {
    async listCourses(ctx) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CourseRow[]>(
          `SELECT ${SELECT_COLUMNS} FROM course ORDER BY title`,
        );
        return rows.map(toRecord);
      });
    },

    async getCourse(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CourseRow[]>(
          `SELECT ${SELECT_COLUMNS} FROM course WHERE id = $1 LIMIT 1`,
          id,
        );
        const row = rows[0];
        return row ? toRecord(row) : null;
      });
    },

    async createCourse(ctx, input: NewCourseInput) {
      return withTenant(ctx, async (db) => {
        // A course is backed 1:1 by an org_unit of type 'course_offering';
        // create that first, then the course row that references it.
        const orgUnitId = generateId();
        await db.$executeRawUnsafe(
          `INSERT INTO org_unit (id, tenant_id, type, name)
           VALUES ($1, $2, 'course_offering', $3)`,
          orgUnitId,
          ctx.tenantId,
          input.title,
        );
        const rows = await db.$queryRawUnsafe<CourseRow[]>(
          `INSERT INTO course
             (tenant_id, org_unit_id, title, description, start_date, end_date)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${SELECT_COLUMNS}`,
          ctx.tenantId,
          orgUnitId,
          input.title,
          input.description ?? null,
          input.startDate ?? null,
          input.endDate ?? null,
        );
        return toRecord(rows[0]!);
      });
    },

    async publishCourse(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CourseRow[]>(
          `UPDATE course SET is_published = true
            WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
          id,
        );
        const row = rows[0];
        return row ? toRecord(row) : null;
      });
    },

    async updateCourse(ctx, id, input: UpdateCourseInput) {
      return withTenant(ctx, async (db) => {
        // Build a partial SET clause from only the provided fields so callers
        // can rename a course without resending unrelated columns.
        const sets: string[] = [];
        const params: unknown[] = [];
        const push = (column: string, value: unknown): void => {
          params.push(value);
          sets.push(`${column} = $${params.length}`);
        };
        if (input.title !== undefined) push("title", input.title);
        if (input.description !== undefined)
          push("description", input.description);
        if (input.startDate !== undefined) push("start_date", input.startDate);
        if (input.endDate !== undefined) push("end_date", input.endDate);

        if (sets.length === 0) {
          const rows = await db.$queryRawUnsafe<CourseRow[]>(
            `SELECT ${SELECT_COLUMNS} FROM course WHERE id = $1 LIMIT 1`,
            id,
          );
          const row = rows[0];
          return row ? toRecord(row) : null;
        }

        params.push(id);
        const rows = await db.$queryRawUnsafe<CourseRow[]>(
          `UPDATE course SET ${sets.join(", ")}
            WHERE id = $${params.length}
          RETURNING ${SELECT_COLUMNS}`,
          ...params,
        );
        const row = rows[0];
        return row ? toRecord(row) : null;
      });
    },

    async deleteCourse(ctx, id) {
      return withTenant(ctx, async (db) => {
        const affected = await db.$executeRawUnsafe(
          `DELETE FROM course WHERE id = $1`,
          id,
        );
        return affected > 0;
      });
    },
  };
}
