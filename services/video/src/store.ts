import type { TenantContext } from "@lms/types";

import type { Principal } from "./access.js";
import type { CaptionTrack, Rendition } from "./transcoder.js";

/** Lifecycle of a video asset (matches the `video_asset.status` CHECK). */
export type VideoStatus = "uploaded" | "transcoding" | "ready" | "failed";

export const VIDEO_STATUSES: readonly VideoStatus[] = [
  "uploaded",
  "transcoding",
  "ready",
  "failed",
];

export interface VideoRecord {
  id: string;
  tenantId: string;
  ownerId: string | null;
  title: string;
  sourceBlobUrl: string;
  status: VideoStatus;
  renditions: Rendition[];
  captions: CaptionTrack[];
  durationSeconds: number | null;
  /**
   * Optional course association (#319). When set, reads/streams are restricted
   * to enrolled students / course teachers / admins (an app-authz filter over
   * RLS); when `null`, any tenant member may read (legacy behavior).
   */
  courseId: string | null;
  createdAt: string;
}

export interface NewVideoInput {
  title: string;
  sourceBlobUrl: string;
  ownerId: string;
  /** Optional course to scope streaming access to (#319). */
  courseId?: string | null;
}

/**
 * Persistence boundary for the video service. Routes depend only on this
 * interface; production uses an RLS-scoped Postgres implementation, tests an
 * in-memory one. Every method runs tenant-scoped (`withTenant` in the Postgres
 * store), so `tenant_id` is stamped from the context, never client-supplied.
 */
export interface VideoStore {
  createVideo(ctx: TenantContext, input: NewVideoInput): Promise<VideoRecord>;

  /**
   * List videos the `viewer` may access (#319): course-scoped videos are
   * filtered out unless the viewer is enrolled/teaching/admin; `course_id IS
   * NULL` videos remain listed for any tenant member. Filtering is DB-side in
   * the Postgres store; the memory store replicates it via the injected policy.
   */
  listVideos(ctx: TenantContext, viewer: Principal): Promise<VideoRecord[]>;

  getVideo(ctx: TenantContext, id: string): Promise<VideoRecord | null>;

  setStatus(
    ctx: TenantContext,
    id: string,
    status: VideoStatus,
  ): Promise<VideoRecord | null>;

  /** Persist transcode output and mark the asset `ready`. */
  setRenditionsAndDuration(
    ctx: TenantContext,
    id: string,
    renditions: Rendition[],
    durationSeconds: number,
  ): Promise<VideoRecord | null>;

  /** Full-replace the caption tracks (auto from the pipeline, or manual edit). */
  setCaptions(
    ctx: TenantContext,
    id: string,
    captions: CaptionTrack[],
  ): Promise<VideoRecord | null>;
}

/**
 * Validate a manual caption-track array (the `PATCH /captions` body). Pure so it
 * is unit-testable without a store. Returns the normalized tracks or an error
 * reason. Manual edits are always stamped `kind:"manual"`.
 */
export type ParseCaptionsResult =
  | { ok: true; captions: CaptionTrack[] }
  | { ok: false; message: string };

export function parseCaptionTracks(value: unknown): ParseCaptionsResult {
  if (!Array.isArray(value)) {
    return { ok: false, message: "captions must be an array." };
  }
  const captions: CaptionTrack[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, message: "each caption track must be an object." };
    }
    const t = raw as Record<string, unknown>;
    if (typeof t.lang !== "string" || t.lang.trim().length === 0) {
      return { ok: false, message: "each caption track needs a non-empty lang." };
    }
    if (typeof t.url !== "string" || t.url.trim().length === 0) {
      return { ok: false, message: "each caption track needs a non-empty url." };
    }
    const label =
      typeof t.label === "string" && t.label.trim().length > 0
        ? t.label.trim()
        : t.lang.trim();
    captions.push({
      lang: t.lang.trim(),
      label,
      url: t.url.trim(),
      kind: "manual",
    });
  }
  return { ok: true, captions };
}
