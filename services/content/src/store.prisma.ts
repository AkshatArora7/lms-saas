import { withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

import { isPassing } from "./scorm/runtime.js";
import {
  slugify,
  type ContentStore,
  type CreateTopicResult,
  type ModuleDetail,
  type ModuleRecord,
  type NewModuleInput,
  type NewPageInput,
  type NewReleaseConditionInput,
  type NewScormPackageInput,
  type NewTopicInput,
  type PageDetail,
  type PageRecord,
  type PageStatus,
  type PageVersionRecord,
  type PageVersionState,
  type ReleaseConditionRecord,
  type SaveScormAttemptInput,
  type SaveScormAttemptResult,
  type ScormAttemptRecord,
  type ScormCompletionStatus,
  type ScormPackageRecord,
  type ScormSuccessStatus,
  type TopicKind,
  type TopicRecord,
  type UpdateModuleInput,
  type UpdatePageInput,
  type UpdateTopicInput,
} from "./store.js";
import type { ScormVersion } from "./scorm/manifest.js";

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

interface PageRow {
  id: string;
  tenant_id: string;
  course_id: string;
  title: string;
  slug: string;
  status: PageStatus;
  published_version_id: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}
interface PageVersionRow {
  id: string;
  tenant_id: string;
  page_id: string;
  version_number: number | string;
  body: string;
  state: PageVersionState;
  created_by: string | null;
  created_at: Date | string;
}

interface ScormPackageRow {
  id: string;
  tenant_id: string;
  topic_id: string | null;
  version: ScormVersion;
  title: string | null;
  launch_href: string;
  mastery_score: number | string | null;
  manifest: unknown;
  blob_url: string;
}
interface ScormAttemptRow {
  id: string;
  tenant_id: string;
  package_id: string;
  learner_id: string;
  completion_status: ScormCompletionStatus;
  success_status: ScormSuccessStatus;
  score_scaled: number | string | null;
  score_raw: number | string | null;
  lesson_status: string | null;
  session_time: string | null;
  total_time: string | null;
  attempted_at: Date | string;
  updated_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function numOrNull(v: number | string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function toPage(r: PageRow): PageRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    courseId: r.course_id,
    title: r.title,
    slug: r.slug,
    status: r.status,
    publishedVersionId: r.published_version_id,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function toPageVersion(r: PageVersionRow): PageVersionRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    pageId: r.page_id,
    versionNumber: Number(r.version_number),
    body: r.body,
    state: r.state,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
  };
}

function toScormPackage(r: ScormPackageRow): ScormPackageRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    topicId: r.topic_id,
    version: r.version,
    title: r.title,
    launchHref: r.launch_href,
    masteryScore: numOrNull(r.mastery_score),
    blobUrl: r.blob_url,
    manifest: asObject(r.manifest),
  };
}
function toScormAttempt(r: ScormAttemptRow): ScormAttemptRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    packageId: r.package_id,
    learnerId: r.learner_id,
    completionStatus: r.completion_status,
    successStatus: r.success_status,
    scoreScaled: numOrNull(r.score_scaled),
    scoreRaw: numOrNull(r.score_raw),
    lessonStatus: r.lesson_status,
    sessionTime: r.session_time,
    totalTime: r.total_time,
    attemptedAt: iso(r.attempted_at),
    updatedAt: iso(r.updated_at),
  };
}

const MODULE_COLS = `id, tenant_id, course_id, parent_id, title, position, created_at`;
const TOPIC_COLS = `id, tenant_id, module_id, title, kind, body, blob_url, position, is_required, created_at`;
const RELEASE_COLS = `id, tenant_id, course_id, target_type, target_id, expression, created_at`;
const PAGE_COLS = `id, tenant_id, course_id, title, slug, status, published_version_id, created_by, created_at, updated_at`;
const PAGE_VERSION_COLS = `id, tenant_id, page_id, version_number, body, state, created_by, created_at`;
const SCORM_PACKAGE_COLS = `id, tenant_id, topic_id, version, title, launch_href, mastery_score, manifest, blob_url`;
const SCORM_ATTEMPT_COLS = `id, tenant_id, package_id, learner_id, completion_status, success_status, score_scaled, score_raw, lesson_status, session_time, total_time, attempted_at, updated_at`;

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

    // --- Rich pages (#32) --------------------------------------------------
    async createPage(ctx, courseId, input: NewPageInput) {
      return withTenant(ctx, async (db: Db) => {
        const slug = input.slug ? slugify(input.slug) : slugify(input.title);
        const pageRows = await db.$queryRawUnsafe<PageRow[]>(
          `INSERT INTO page (tenant_id, course_id, title, slug, status)
           VALUES ($1::uuid, $2::uuid, $3, $4, 'draft')
           RETURNING ${PAGE_COLS}`,
          ctx.tenantId,
          courseId,
          input.title,
          slug,
        );
        const page = pageRows[0]!;
        // Append version #1 (draft) capturing the initial body.
        await db.$executeRawUnsafe(
          `INSERT INTO page_version
             (tenant_id, page_id, version_number, body, state)
           VALUES ($1::uuid, $2::uuid, 1, $3, 'draft')`,
          ctx.tenantId,
          page.id,
          input.body ?? "",
        );
        return toPage(page);
      });
    },

    async listPages(ctx, courseId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<PageRow[]>(
          `SELECT ${PAGE_COLS} FROM page
            WHERE course_id = $1::uuid ORDER BY created_at`,
          courseId,
        );
        return rows.map(toPage);
      });
    },

    async getPage(ctx, id): Promise<PageDetail | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<PageRow[]>(
          `SELECT ${PAGE_COLS} FROM page WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (rows.length === 0) return null;
        const page = toPage(rows[0]!);
        // Current version = latest draft if any, else the published version.
        const drafts = await db.$queryRawUnsafe<PageVersionRow[]>(
          `SELECT ${PAGE_VERSION_COLS} FROM page_version
            WHERE page_id = $1::uuid AND state = 'draft'
            ORDER BY version_number DESC LIMIT 1`,
          id,
        );
        let currentVersion: PageVersionRecord | null = drafts[0]
          ? toPageVersion(drafts[0])
          : null;
        if (!currentVersion && page.publishedVersionId) {
          const pub = await db.$queryRawUnsafe<PageVersionRow[]>(
            `SELECT ${PAGE_VERSION_COLS} FROM page_version
              WHERE id = $1::uuid LIMIT 1`,
            page.publishedVersionId,
          );
          currentVersion = pub[0] ? toPageVersion(pub[0]) : null;
        }
        return { ...page, currentVersion };
      });
    },

    async updatePage(ctx, id, input: UpdatePageInput) {
      return withTenant(ctx, async (db: Db) => {
        const existing = await db.$queryRawUnsafe<PageRow[]>(
          `SELECT ${PAGE_COLS} FROM page WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (existing.length === 0) return null;
        if (input.body !== undefined) {
          // Never mutate a version — append a new draft (max version_number + 1).
          await db.$executeRawUnsafe(
            `INSERT INTO page_version
               (tenant_id, page_id, version_number, body, state)
             SELECT $1::uuid, $2::uuid,
                    COALESCE(MAX(version_number), 0) + 1, $3, 'draft'
               FROM page_version WHERE page_id = $2::uuid`,
            ctx.tenantId,
            id,
            input.body,
          );
        }
        const sets: string[] = [];
        const params: unknown[] = [];
        if (input.title !== undefined) {
          params.push(input.title);
          sets.push(`title = $${params.length}`);
        }
        if (input.slug !== undefined) {
          params.push(slugify(input.slug));
          sets.push(`slug = $${params.length}`);
        }
        // Touch updated_at even when only the body changed (trigger fires on UPDATE).
        sets.push(`updated_at = now()`);
        params.push(id);
        const rows = await db.$queryRawUnsafe<PageRow[]>(
          `UPDATE page SET ${sets.join(", ")}
            WHERE id = $${params.length}::uuid RETURNING ${PAGE_COLS}`,
          ...params,
        );
        return rows[0] ? toPage(rows[0]) : null;
      });
    },

    async publishPage(ctx, id, versionId?: string) {
      return withTenant(ctx, async (db: Db) => {
        const pageRows = await db.$queryRawUnsafe<PageRow[]>(
          `SELECT ${PAGE_COLS} FROM page WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (pageRows.length === 0) return null;
        const target = versionId
          ? await db.$queryRawUnsafe<PageVersionRow[]>(
              `SELECT ${PAGE_VERSION_COLS} FROM page_version
                WHERE id = $1::uuid AND page_id = $2::uuid LIMIT 1`,
              versionId,
              id,
            )
          : await db.$queryRawUnsafe<PageVersionRow[]>(
              `SELECT ${PAGE_VERSION_COLS} FROM page_version
                WHERE page_id = $1::uuid AND state = 'draft'
                ORDER BY version_number DESC LIMIT 1`,
              id,
            );
        if (target.length === 0) return null;
        const versionRowId = target[0]!.id;
        await db.$executeRawUnsafe(
          `UPDATE page_version SET state = 'published' WHERE id = $1::uuid`,
          versionRowId,
        );
        const rows = await db.$queryRawUnsafe<PageRow[]>(
          `UPDATE page
              SET status = 'published',
                  published_version_id = $1::uuid,
                  updated_at = now()
            WHERE id = $2::uuid RETURNING ${PAGE_COLS}`,
          versionRowId,
          id,
        );
        return rows[0] ? toPage(rows[0]) : null;
      });
    },

    async listPageVersions(ctx, pageId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<PageVersionRow[]>(
          `SELECT ${PAGE_VERSION_COLS} FROM page_version
            WHERE page_id = $1::uuid ORDER BY version_number DESC`,
          pageId,
        );
        return rows.map(toPageVersion);
      });
    },

    async getPageVersion(ctx, pageId, versionId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<PageVersionRow[]>(
          `SELECT ${PAGE_VERSION_COLS} FROM page_version
            WHERE id = $1::uuid AND page_id = $2::uuid LIMIT 1`,
          versionId,
          pageId,
        );
        return rows[0] ? toPageVersion(rows[0]) : null;
      });
    },

    // --- SCORM (#31) -------------------------------------------------------
    async createScormPackage(ctx, input: NewScormPackageInput) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ScormPackageRow[]>(
          `INSERT INTO scorm_package
             (tenant_id, topic_id, version, title, launch_href, mastery_score, manifest, blob_url)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8)
           RETURNING ${SCORM_PACKAGE_COLS}`,
          ctx.tenantId,
          input.topicId ?? null,
          input.version,
          input.title,
          input.launchHref,
          input.masteryScore,
          JSON.stringify(input.manifest),
          input.blobUrl,
        );
        return toScormPackage(rows[0]!);
      });
    },

    async getScormPackage(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ScormPackageRow[]>(
          `SELECT ${SCORM_PACKAGE_COLS} FROM scorm_package WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toScormPackage(rows[0]) : null;
      });
    },

    async saveScormAttempt(
      ctx,
      packageId,
      input: SaveScormAttemptInput,
    ): Promise<SaveScormAttemptResult> {
      return withTenant<SaveScormAttemptResult>(ctx, async (db: Db) => {
        // Guard: the package must exist in this tenant (also gives us the
        // mastery score for the pass determination on the gradebook event).
        const pkgRows = await db.$queryRawUnsafe<
          { id: string; mastery_score: number | string | null }[]
        >(
          `SELECT id, mastery_score FROM scorm_package WHERE id = $1::uuid LIMIT 1`,
          packageId,
        );
        if (pkgRows.length === 0) {
          return { ok: false, reason: "package_not_found" };
        }
        const masteryScore = numOrNull(pkgRows[0]!.mastery_score);

        const rows = await db.$queryRawUnsafe<ScormAttemptRow[]>(
          `INSERT INTO scorm_attempt
             (tenant_id, package_id, learner_id, completion_status, success_status,
              score_scaled, score_raw, lesson_status, session_time, total_time)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (tenant_id, package_id, learner_id) DO UPDATE SET
             completion_status = EXCLUDED.completion_status,
             success_status    = EXCLUDED.success_status,
             score_scaled      = EXCLUDED.score_scaled,
             score_raw         = EXCLUDED.score_raw,
             lesson_status     = EXCLUDED.lesson_status,
             session_time      = EXCLUDED.session_time,
             total_time        = EXCLUDED.total_time,
             updated_at        = now()
           RETURNING ${SCORM_ATTEMPT_COLS}`,
          ctx.tenantId,
          packageId,
          input.learnerId,
          input.completionStatus ?? "unknown",
          input.successStatus ?? "unknown",
          input.scoreScaled ?? null,
          input.scoreRaw ?? null,
          input.lessonStatus ?? null,
          input.sessionTime ?? null,
          input.totalTime ?? null,
        );
        const attempt = toScormAttempt(rows[0]!);

        // Surface results to the gradebook/analytics path: emit a learning
        // event in the SAME transaction (outbox pattern, attendance §) when the
        // attempt reaches a terminal/passing state.
        const passed = isPassing(
          {
            successStatus: attempt.successStatus,
            scoreScaled: attempt.scoreScaled,
          },
          masteryScore,
        );
        const terminal =
          attempt.completionStatus === "completed" ||
          attempt.successStatus === "passed" ||
          attempt.successStatus === "failed";
        if (terminal) {
          await db.$executeRawUnsafe(
            `INSERT INTO event_outbox (tenant_id, type, actor_id, payload)
             VALUES ($1::uuid, $2, $3::uuid, $4::jsonb)`,
            ctx.tenantId,
            EVENT_TYPES.LEARNING_EVENT_CAPTURED,
            attempt.learnerId,
            JSON.stringify({
              source: "scorm",
              packageId: attempt.packageId,
              learnerId: attempt.learnerId,
              completionStatus: attempt.completionStatus,
              successStatus: attempt.successStatus,
              scoreScaled: attempt.scoreScaled,
              scoreRaw: attempt.scoreRaw,
              passed,
            }),
          );
        }
        return { ok: true, attempt };
      });
    },

    async getScormAttempt(ctx, packageId, learnerId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ScormAttemptRow[]>(
          `SELECT ${SCORM_ATTEMPT_COLS} FROM scorm_attempt
            WHERE package_id = $1::uuid AND learner_id = $2::uuid LIMIT 1`,
          packageId,
          learnerId,
        );
        return rows[0] ? toScormAttempt(rows[0]) : null;
      });
    },
  };
}
