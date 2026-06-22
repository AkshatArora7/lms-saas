import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

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

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
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
      createdAt: this.now().toISOString(),
    };
    this.videos.push(video);
    return { ...video };
  }

  async listVideos(ctx: TenantContext): Promise<VideoRecord[]> {
    return this.videos
      .filter((v) => v.tenantId === ctx.tenantId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
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
    return { ...video };
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
