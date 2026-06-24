import { TENANT_ID } from "./auth";

/**
 * Server-only client for the video microservice (#320).
 *
 * This is the BFF read boundary the learner/teacher surfaces use to read video
 * assets. Every call forwards the trusted identity headers the gateway would
 * stamp from verified claims (mirroring `analytics-api.ts` /
 * `guardian-attendance.ts`): `x-tenant-id` (tenant scope), and for the
 * course-scoped reads `x-user-id` + `x-user-roles` so the video service's
 * course-access gate (#319, ADR-0031 — deny = 404, existence-hiding) is
 * authoritative. The caller identity is ALWAYS the server-resolved session,
 * never a client-supplied value.
 *
 * Reads return a discriminated-union result (or a safe `[]` for the list) so the
 * Server Component renders clean error/empty/data states rather than throwing.
 */

export const VIDEO_SERVICE_URL =
  process.env.VIDEO_SERVICE_URL ?? "http://localhost:4020";

/** Lifecycle of a video asset (matches the service `video_asset.status`). */
export type VideoStatus = "uploaded" | "transcoding" | "ready" | "failed";

/** A single adaptive-streaming rendition (manifest/stream URL on Blob/CDN). */
export interface Rendition {
  quality: "480p" | "720p" | "1080p" | "auto" | string;
  url: string;
  type: "hls" | "dash" | "mp4";
}

/** A caption/subtitle track (auto from the pipeline, or manual). */
export interface CaptionTrack {
  /** BCP-47 language tag, e.g. "en". */
  lang: string;
  label: string;
  /** WebVTT URL on Blob/CDN. */
  url: string;
  kind: "auto" | "manual";
}

/** The playback contract the service returns from `toResponse`. */
export interface VideoRecord {
  id: string;
  title: string;
  sourceBlobUrl: string;
  ownerId: string | null;
  status: VideoStatus;
  renditions: Rendition[];
  captions: CaptionTrack[];
  durationSeconds: number | null;
  courseId: string | null;
  createdAt: string;
}

/** Caller identity passed to the video service for course-scoped reads. */
export interface VideoCaller {
  userId: string;
  roles: string[];
}

export type GetVideoResult =
  | { ok: true; video: VideoRecord }
  /** notFound = 404/403 (existence-hiding gate) — the asset is missing OR the
   * caller may not read it; surfaced as a single "unavailable" state so we never
   * confirm an id exists to an unauthorized caller. */
  | { ok: false; status: number; error: string };

/** The signed-upload contract the service returns from `POST /uploads`. */
export interface SignedUpload {
  key: string;
  uploadUrl: string;
  blobUrl: string;
}

export type SignedUploadResult =
  | { ok: true; upload: SignedUpload }
  | { ok: false; status: number; error: string };

export type CreateVideoResult =
  | { ok: true; video: VideoRecord }
  | { ok: false; status: number; error: string };

export interface RequestUploadInput {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface CreateVideoInput {
  title: string;
  sourceBlobUrl: string;
  courseId?: string | null;
}

/** Forward the trusted tenant + caller identity (server session only). */
function callerHeaders(tenantId: string, caller: VideoCaller): HeadersInit {
  return {
    "x-tenant-id": tenantId,
    "x-user-id": caller.userId,
    "x-user-roles": caller.roles.join(","),
  };
}

/** Caller headers + JSON content-type for write calls. */
function writeHeaders(tenantId: string, caller: VideoCaller): HeadersInit {
  return { ...callerHeaders(tenantId, caller), "content-type": "application/json" };
}

const OFFLINE =
  "The video service is unavailable. Start it (VIDEO_STORE=memory pnpm dev in services/video) to manage or play videos.";

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return data.message ?? fallback;
}

/**
 * Fetch a single video asset by id, with the caller identity so course-scoped
 * videos are gated by the service. Returns a discriminated union; a 404/403 maps
 * to a single "unavailable" state.
 */
export async function getVideo(
  id: string,
  caller: VideoCaller,
  tenantId: string = TENANT_ID,
): Promise<GetVideoResult> {
  try {
    const res = await fetch(
      `${VIDEO_SERVICE_URL}/videos/${encodeURIComponent(id)}`,
      { headers: callerHeaders(tenantId, caller), cache: "no-store" },
    );
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(
          res,
          "This video is unavailable. It may have been removed or you don't have access.",
        ),
      };
    }
    const data = (await res.json()) as { video: VideoRecord };
    return { ok: true, video: data.video };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

/**
 * List the videos the caller may read, filtered to a single course. The service
 * `GET /videos` already filters by the caller's access (course-scoped videos are
 * only listed for enrolled/teaching/admin callers); we additionally narrow to
 * `courseId` here so a teacher's course-videos screen shows only that course's
 * library. Returns `[]` on any error so the screen renders a clean
 * empty/offline state.
 */
export async function listCourseVideos(
  courseId: string,
  caller: VideoCaller,
  tenantId: string = TENANT_ID,
): Promise<VideoRecord[]> {
  try {
    const res = await fetch(`${VIDEO_SERVICE_URL}/videos`, {
      headers: callerHeaders(tenantId, caller),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { videos: VideoRecord[] };
    return (data.videos ?? []).filter((v) => v.courseId === courseId);
  } catch {
    return [];
  }
}

/**
 * Request a signed upload (`POST /uploads`). The service validates the
 * content-type allow-list and the max size, returning `413` (too large) or
 * `415` (unsupported type) which we surface to the BFF route verbatim so the
 * client can show a friendly error.
 */
export async function requestUpload(
  input: RequestUploadInput,
  caller: VideoCaller,
  tenantId: string = TENANT_ID,
): Promise<SignedUploadResult> {
  try {
    const res = await fetch(`${VIDEO_SERVICE_URL}/uploads`, {
      method: "POST",
      headers: writeHeaders(tenantId, caller),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Couldn't start the upload."),
      };
    }
    const data = (await res.json()) as { upload: SignedUpload };
    return { ok: true, upload: data.upload };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

/**
 * Create the video asset after the bytes are uploaded (`POST /videos`). The
 * service stamps the owner from the trusted `x-user-id` and kicks off the
 * transcode pipeline; the returned record carries the current status.
 */
export async function createVideo(
  input: CreateVideoInput,
  caller: VideoCaller,
  tenantId: string = TENANT_ID,
): Promise<CreateVideoResult> {
  try {
    const res = await fetch(`${VIDEO_SERVICE_URL}/videos`, {
      method: "POST",
      headers: writeHeaders(tenantId, caller),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Couldn't save the video."),
      };
    }
    const data = (await res.json()) as { video: VideoRecord };
    return { ok: true, video: data.video };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}

/**
 * (Re)run the transcode pipeline for a video (`POST /videos/:id/transcode`).
 * Owner or admin only (the service enforces it from `x-user-id`/`x-user-roles`).
 */
export async function retranscodeVideo(
  id: string,
  caller: VideoCaller,
  tenantId: string = TENANT_ID,
): Promise<CreateVideoResult> {
  try {
    const res = await fetch(
      `${VIDEO_SERVICE_URL}/videos/${encodeURIComponent(id)}/transcode`,
      {
        method: "POST",
        headers: writeHeaders(tenantId, caller),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await readError(res, "Couldn't restart processing."),
      };
    }
    const data = (await res.json()) as { video: VideoRecord };
    return { ok: true, video: data.video };
  } catch {
    return { ok: false, status: 503, error: OFFLINE };
  }
}
