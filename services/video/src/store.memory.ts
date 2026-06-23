import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  FakeCourseAccessPolicy,
  type CourseAccessPolicy,
  type Principal,
} from "./access.js";
import {
  videoFailedEvent,
  videoReadyEvent,
  type VideoOutboxEvent,
} from "./events.js";
import type { CaptionTrack, Rendition } from "./transcoder.js";
import type {
  NewVideoInput,
  VideoRecord,
  VideoStatus,
  VideoStore,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory VideoStore. Rows are filtered by tenant id to emulate the RLS
 * isolation Postgres enforces. Used by the test suite and `VIDEO_STORE=memory`.
 */
export class MemoryVideoStore implements VideoStore {
  private videos: VideoRecord[] = [];

  /**
   * Captured outbox events, in emission order. Mirrors the rows the Prisma store
   * INSERTs into `event_outbox`, with the acting tenant recorded so tests can
   * assert tenant scoping (ADR-0035).
   */
  readonly outbox: (VideoOutboxEvent & { tenantId: string })[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
    /**
     * Course-access policy used to replicate the DB-side list filter offline
     * (#319). Defaults to an empty Fake (admins see all course-scoped videos;
     * everyone else sees only `course_id IS NULL` ones).
     */
    private readonly policy: CourseAccessPolicy = new FakeCourseAccessPolicy(),
  ) {}

  async createVideo(
    ctx: TenantContext,
    input: NewVideoInput,
  ): Promise<VideoRecord> {
    const video: VideoRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      ownerId: input.ownerId,
      title: input.title,
      sourceBlobUrl: input.sourceBlobUrl,
      status: "uploaded",
      renditions: [],
      captions: [],
      durationSeconds: null,
      courseId: input.courseId ?? null,
      createdAt: this.now().toISOString(),
    };
    this.videos.push(video);
    return { ...video };
  }

  async listVideos(
    ctx: TenantContext,
    viewer: Principal,
  ): Promise<VideoRecord[]> {
    const tenantVideos = this.videos
      .filter((v) => v.tenantId === ctx.tenantId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const courseIds = tenantVideos
      .map((v) => v.courseId)
      .filter((c): c is string => c !== null);
    const visible = await this.policy.visibleCourseIds(ctx, courseIds, viewer);
    return tenantVideos
      .filter((v) => v.courseId === null || visible.has(v.courseId))
      .map((v) => ({ ...v }));
  }

  async getVideo(ctx: TenantContext, id: string): Promise<VideoRecord | null> {
    const video = this.videos.find(
      (v) => v.id === id && v.tenantId === ctx.tenantId,
    );
    return video ? { ...video } : null;
  }

  async setStatus(
    ctx: TenantContext,
    id: string,
    status: VideoStatus,
  ): Promise<VideoRecord | null> {
    const video = this.videos.find(
      (v) => v.id === id && v.tenantId === ctx.tenantId,
    );
    if (!video) return null;
    video.status = status;
    return { ...video };
  }

  async setRenditionsAndDuration(
    ctx: TenantContext,
    id: string,
    renditions: Rendition[],
    durationSeconds: number,
  ): Promise<VideoRecord | null> {
    const video = this.videos.find(
      (v) => v.id === id && v.tenantId === ctx.tenantId,
    );
    if (!video) return null;
    video.renditions = renditions;
    video.durationSeconds = durationSeconds;
    video.status = "ready";
    const record = { ...video };
    // Emit `video.ready` alongside the terminal status flip (ADR-0035).
    this.outbox.push({ tenantId: ctx.tenantId, ...videoReadyEvent(record) });
    return record;
  }

  async markFailed(
    ctx: TenantContext,
    id: string,
    reason: string,
  ): Promise<VideoRecord | null> {
    const video = this.videos.find(
      (v) => v.id === id && v.tenantId === ctx.tenantId,
    );
    if (!video) return null;
    video.status = "failed";
    const record = { ...video };
    // Emit `video.failed` alongside the terminal status flip (ADR-0035).
    this.outbox.push({
      tenantId: ctx.tenantId,
      ...videoFailedEvent(record, reason),
    });
    return record;
  }

  async setCaptions(
    ctx: TenantContext,
    id: string,
    captions: CaptionTrack[],
  ): Promise<VideoRecord | null> {
    const video = this.videos.find(
      (v) => v.id === id && v.tenantId === ctx.tenantId,
    );
    if (!video) return null;
    video.captions = captions;
    return { ...video };
  }
}
