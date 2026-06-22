import { withTenant } from "@lms/db";

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
    createdAt: iso(r.created_at),
  };
}

const VIDEO_COLS = `id, tenant_id, owner_id, title, source_blob_url, status, renditions, captions, duration_seconds, created_at`;

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
          `INSERT INTO video_asset (tenant_id, owner_id, title, source_blob_url, status)
           VALUES ($1::uuid, $2::uuid, $3, $4, 'uploaded')
           RETURNING ${VIDEO_COLS}`,
          ctx.tenantId,
          input.ownerId,
          input.title,
          input.sourceBlobUrl,
        );
        return toVideo(rows[0]!);
      });
    },

    async listVideos(ctx) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<VideoRow[]>(
          `SELECT ${VIDEO_COLS} FROM video_asset ORDER BY created_at DESC`,
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
        return rows[0] ? toVideo(rows[0]) : null;
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
