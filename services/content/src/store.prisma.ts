import { withTenant } from "@lms/db";

import type {
  ContentStore,
  CreateTopicResult,
  ModuleDetail,
  ModuleRecord,
  NewModuleInput,
  NewReleaseConditionInput,
  NewTopicInput,
  ReleaseConditionRecord,
  TopicKind,
  TopicRecord,
  UpdateModuleInput,
  UpdateTopicInput,
} from "./store.js";

interface ModuleRow {
  id: string;
  tenant_id: string;
  course_id: string;
  parent_id: string | null;
  title: string;
  position: number;
  created_at: Date | string;
}
interface TopicRow {
  id: string;
  tenant_id: string;
  module_id: string;
  title: string;
  kind: TopicKind;
  body: string | null;
  blob_url: string | null;
  position: number;
  is_required: boolean;
  created_at: Date | string;
}
interface ReleaseRow {
  id: string;
  tenant_id: string;
  course_id: string;
  target_type: string;
  target_id: string;
  expression: unknown;
  created_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}
function toModule(r: ModuleRow): ModuleRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    courseId: r.course_id,
    parentId: r.parent_id,
    title: r.title,
    position: r.position,
    createdAt: iso(r.created_at),
  };
}
function toTopic(r: TopicRow): TopicRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    moduleId: r.module_id,
    title: r.title,
    kind: r.kind,
    body: r.body,
    blobUrl: r.blob_url,
    position: r.position,
    isRequired: r.is_required,
    createdAt: iso(r.created_at),
  };
}
function toRelease(r: ReleaseRow): ReleaseConditionRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    courseId: r.course_id,
    targetType: r.target_type,
    targetId: r.target_id,
    expression: asObject(r.expression),
    createdAt: iso(r.created_at),
  };
}

const MODULE_COLS = `id, tenant_id, course_id, parent_id, title, position, created_at`;
const TOPIC_COLS = `id, tenant_id, module_id, title, kind, body, blob_url, position, is_required, created_at`;
const RELEASE_COLS = `id, tenant_id, course_id, target_type, target_id, expression, created_at`;

/**
 * Postgres-backed content store. Every call runs through `withTenant`, so all
 * statements are RLS-scoped. Every uuid parameter is cast `::uuid`.
 */
export function createPrismaStore(): ContentStore {
  return {
    async createModule(ctx, courseId, input: NewModuleInput) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ModuleRow[]>(
          `INSERT INTO content_module (tenant_id, course_id, parent_id, title, position)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
           RETURNING ${MODULE_COLS}`,
          ctx.tenantId,
          courseId,
          input.parentId ?? null,
          input.title,
          input.position ?? 0,
        );
        return toModule(rows[0]!);
      });
    },

    async listModules(ctx, courseId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ModuleRow[]>(
          `SELECT ${MODULE_COLS} FROM content_module
            WHERE course_id = $1::uuid ORDER BY position, created_at`,
          courseId,
        );
        return rows.map(toModule);
      });
    },

    async getModule(ctx, id): Promise<ModuleDetail | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ModuleRow[]>(
          `SELECT ${MODULE_COLS} FROM content_module WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (rows.length === 0) return null;
        const topics = await db.$queryRawUnsafe<TopicRow[]>(
          `SELECT ${TOPIC_COLS} FROM content_topic WHERE module_id = $1::uuid
            ORDER BY position, created_at`,
          id,
        );
        return { ...toModule(rows[0]!), topics: topics.map(toTopic) };
      });
    },

    async updateModule(ctx, id, input: UpdateModuleInput) {
      return withTenant(ctx, async (db: Db) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (input.title !== undefined) {
          params.push(input.title);
          sets.push(`title = $${params.length}`);
        }
        if (input.position !== undefined) {
          params.push(input.position);
          sets.push(`position = $${params.length}`);
        }
        if (sets.length === 0) {
          const cur = await db.$queryRawUnsafe<ModuleRow[]>(
            `SELECT ${MODULE_COLS} FROM content_module WHERE id = $1::uuid LIMIT 1`,
            id,
          );
          return cur[0] ? toModule(cur[0]) : null;
        }
        params.push(id);
        const rows = await db.$queryRawUnsafe<ModuleRow[]>(
          `UPDATE content_module SET ${sets.join(", ")}
            WHERE id = $${params.length}::uuid RETURNING ${MODULE_COLS}`,
          ...params,
        );
        return rows[0] ? toModule(rows[0]) : null;
      });
    },

    async deleteModule(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM content_module WHERE id = $1::uuid`,
          id,
        );
        return n > 0;
      });
    },

    async createTopic(ctx, moduleId, input: NewTopicInput): Promise<CreateTopicResult> {
      return withTenant<CreateTopicResult>(ctx, async (db: Db) => {
        const mod = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM content_module WHERE id = $1::uuid LIMIT 1`,
          moduleId,
        );
        if (mod.length === 0) return { ok: false, reason: "module_not_found" };
        const rows = await db.$queryRawUnsafe<TopicRow[]>(
          `INSERT INTO content_topic
             (tenant_id, module_id, title, kind, body, blob_url, position, is_required)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
           RETURNING ${TOPIC_COLS}`,
          ctx.tenantId,
          moduleId,
          input.title,
          input.kind ?? "html",
          input.body ?? null,
          input.blobUrl ?? null,
          input.position ?? 0,
          input.isRequired ?? false,
        );
        return { ok: true, topic: toTopic(rows[0]!) };
      });
    },

    async listTopics(ctx, moduleId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<TopicRow[]>(
          `SELECT ${TOPIC_COLS} FROM content_topic WHERE module_id = $1::uuid
            ORDER BY position, created_at`,
          moduleId,
        );
        return rows.map(toTopic);
      });
    },

    async updateTopic(ctx, id, input: UpdateTopicInput) {
      return withTenant(ctx, async (db: Db) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        const set = (col: string, val: unknown) => {
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        };
        if (input.title !== undefined) set("title", input.title);
        if (input.body !== undefined) set("body", input.body);
        if (input.blobUrl !== undefined) set("blob_url", input.blobUrl);
        if (input.position !== undefined) set("position", input.position);
        if (input.isRequired !== undefined) set("is_required", input.isRequired);
        if (sets.length === 0) {
          const cur = await db.$queryRawUnsafe<TopicRow[]>(
            `SELECT ${TOPIC_COLS} FROM content_topic WHERE id = $1::uuid LIMIT 1`,
            id,
          );
          return cur[0] ? toTopic(cur[0]) : null;
        }
        params.push(id);
        const rows = await db.$queryRawUnsafe<TopicRow[]>(
          `UPDATE content_topic SET ${sets.join(", ")}
            WHERE id = $${params.length}::uuid RETURNING ${TOPIC_COLS}`,
          ...params,
        );
        return rows[0] ? toTopic(rows[0]) : null;
      });
    },

    async deleteTopic(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM content_topic WHERE id = $1::uuid`,
          id,
        );
        return n > 0;
      });
    },

    async createReleaseCondition(ctx, courseId, input: NewReleaseConditionInput) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ReleaseRow[]>(
          `INSERT INTO release_condition
             (tenant_id, course_id, target_type, target_id, expression)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb)
           RETURNING ${RELEASE_COLS}`,
          ctx.tenantId,
          courseId,
          input.targetType,
          input.targetId,
          JSON.stringify(input.expression),
        );
        return toRelease(rows[0]!);
      });
    },

    async listReleaseConditions(ctx, courseId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ReleaseRow[]>(
          `SELECT ${RELEASE_COLS} FROM release_condition
            WHERE course_id = $1::uuid ORDER BY created_at`,
          courseId,
        );
        return rows.map(toRelease);
      });
    },

    async deleteReleaseCondition(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM release_condition WHERE id = $1::uuid`,
          id,
        );
        return n > 0;
      });
    },
  };
}
