import { withTenant } from "@lms/db";

import type { Principal } from "./access.js";
import { videoFailedEvent, videoReadyEvent } from "./events.js";
import { ADMIN_ROLES } from "./routes.js";
import type { CaptionTrack, Rendition } from "./transcoder.js";
import type {
  NewVideoInput,
  VideoRecord,
  VideoStatus,
  VideoStore,
} from "./store.js";

interface VideoRow {
  id: string;
  tenant_id: string;
  owner_id: string | null;
  title: string;
  source_blob_url: string;
  status: VideoStatus;
  renditions: unknown;
  captions: unknown;
  duration_seconds: number | string | null;
  course_id: string | null;
  created_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Parse a jsonb column that may arrive as a parsed array or a JSON string. */
function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toVideo(r: VideoRow): VideoRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ownerId: r.owner_id,
    title: r.title,
    sourceBlobUrl: r.source_blob_url,
    status: r.status,
    renditions: asArray<Rendition>(r.renditions),
    captions: asArray<CaptionTrack>(r.captions),
    durationSeconds:
      r.duration_seconds === null ? null : Number(r.duration_seconds),
    courseId: r.course_id,
    createdAt: iso(r.created_at),
  };
}

const VIDEO_COLS = `id, tenant_id, owner_id, title, source_blob_url, status, renditions, captions, duration_seconds, course_id, created_at`;

/**
 * Does this principal hold a tenant-wide admin role? Admins short-circuit the
 * course-scoped list filter (same set as the routes `isAdmin`).
 */
function isAdminPrincipal(viewer: Principal): boolean {
  return viewer.roles.some((r) =>
    (ADMIN_ROLES as readonly string[]).includes(r),
  );
}

/**
 * Postgres-backed video store. Every call runs through `withTenant`, so all
 * statements are RLS-scoped. Every uuid parameter is cast `::uuid`; jsonb writes
 * go through `::jsonb` with `JSON.stringify`.
 */
export function createPrismaStore(): VideoStore {
  return {
    async createVideo(ctx, input: NewVideoInput) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `INSERT INTO video_asset (tenant_id, owner_id, title, source_blob_url, status, course_id)
           VALUES ($1::uuid, $2::uuid, $3, $4, 'uploaded', $5::uuid)
           RETURNING ${VIDEO_COLS}`,
          ctx.tenantId,
          input.ownerId,
          input.title,
          input.sourceBlobUrl,
          input.courseId ?? null,
        );
        return toVideo(rows[0]!);
      });
    },

    async listVideos(ctx, viewer) {
      return withTenant(ctx, async (db: Db) => {
        // Admins see everything; non-admins see null-course videos plus the
        // course-scoped ones they are enrolled in / teach (DB-side WHERE, so
        // detail and list never disagree — ADR-0031 §D).
        if (isAdminPrincipal(viewer)) {
          const rows = await db.$queryRawUnsafe<VideoRow[]>(
            `SELECT ${VIDEO_COLS} FROM video_asset ORDER BY created_at DESC`,
          );
          return rows.map(toVideo);
        }
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `SELECT ${VIDEO_COLS} FROM video_asset v
            WHERE v.course_id IS NULL
               OR EXISTS (
                    SELECT 1
                      FROM enrollment e
                      JOIN course c ON c.org_unit_id = e.org_unit_id
                     WHERE c.id = v.course_id
                       AND e.user_id = $1::uuid
                       AND e.status IN ('active','completed')
                  )
            ORDER BY v.created_at DESC`,
          viewer.userId,
        );
        return rows.map(toVideo);
      });
    },

    async getVideo(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `SELECT ${VIDEO_COLS} FROM video_asset WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toVideo(rows[0]) : null;
      });
    },

    async setStatus(ctx, id, status: VideoStatus) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `UPDATE video_asset SET status = $1
            WHERE id = $2::uuid RETURNING ${VIDEO_COLS}`,
          status,
          id,
        );
        return rows[0] ? toVideo(rows[0]) : null;
      });
    },

    async setRenditionsAndDuration(
      ctx,
      id,
      renditions: Rendition[],
      durationSeconds: number,
    ) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `UPDATE video_asset
              SET renditions = $1::jsonb, duration_seconds = $2, status = 'ready'
            WHERE id = $3::uuid RETURNING ${VIDEO_COLS}`,
          JSON.stringify(renditions),
          durationSeconds,
          id,
        );
        if (!rows[0]) return null;
        const record = toVideo(rows[0]);
        // Emit `video.ready` in the same tx as the terminal status flip so the
        // state change and the event are atomic (ADR-0035).
        const ev = videoReadyEvent(record);
        await db.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, actor_id, org_unit_id, payload)
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::jsonb)`,
          ctx.tenantId,
          ev.type,
          ev.actorId,
          ev.orgUnitId,
          JSON.stringify(ev.payload),
        );
        return record;
      });
    },

    async markFailed(ctx, id, reason: string) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `UPDATE video_asset SET status = 'failed'
            WHERE id = $1::uuid RETURNING ${VIDEO_COLS}`,
          id,
        );
        if (!rows[0]) return null;
        const record = toVideo(rows[0]);
        // Emit `video.failed` in the same tx as the terminal status flip.
        const ev = videoFailedEvent(record, reason);
        await db.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, actor_id, org_unit_id, payload)
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::jsonb)`,
          ctx.tenantId,
          ev.type,
          ev.actorId,
          ev.orgUnitId,
          JSON.stringify(ev.payload),
        );
        return record;
      });
    },

    async setCaptions(ctx, id, captions: CaptionTrack[]) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `UPDATE video_asset SET captions = $1::jsonb
            WHERE id = $2::uuid RETURNING ${VIDEO_COLS}`,
          JSON.stringify(captions),
          id,
        );
        return rows[0] ? toVideo(rows[0]) : null;
      });
    },
  };
}
