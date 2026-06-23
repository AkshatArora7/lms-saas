import { createLogger } from "@lms/logger";
import type { TenantContext } from "@lms/types";

import type { Captioner } from "./captioner.js";
import type { VideoStore } from "./store.js";
import type { Transcoder } from "./transcoder.js";

const log = createLogger("video");

/**
 * Drives the async transcode→caption pipeline for one asset. The seam lets the
 * production default fire-and-forget (modelling "async" honestly without queue
 * infra), while tests inject a synchronous runner so `app.inject` assertions are
 * deterministic. Mirrors the ADR-0028 injectable-seam precedent.
 */
export interface PipelineRunner {
  run(ctx: TenantContext, videoId: string): void | Promise<void>;
}

export interface PipelineDeps {
  store: VideoStore;
  transcoder: Transcoder;
  captioner: Captioner;
}

/**
 * The actual pipeline body, shared by both runners. Advances
 * `uploaded`→`transcoding`, runs the transcoder + captioner, then persists
 * `renditions`/`captions`/`durationSeconds` and marks `ready` — or `failed` on
 * any throw. Each store step runs tenant-scoped (RLS) under the same ctx.
 */
export async function runPipeline(
  deps: PipelineDeps,
  ctx: TenantContext,
  videoId: string,
): Promise<void> {
  try {
    const transcoding = await deps.store.setStatus(ctx, videoId, "transcoding");
    if (!transcoding) return; // asset vanished (deleted / wrong tenant)
    const asset = {
      id: transcoding.id,
      tenantId: transcoding.tenantId,
      title: transcoding.title,
      sourceBlobUrl: transcoding.sourceBlobUrl,
    };
    const [{ renditions, durationSeconds }, captions] = await Promise.all([
      deps.transcoder.transcode(asset),
      deps.captioner.caption(asset),
    ]);
    await deps.store.setCaptions(ctx, videoId, captions);
    // setRenditionsAndDuration also flips status → 'ready' (terminal success).
    await deps.store.setRenditionsAndDuration(
      ctx,
      videoId,
      renditions,
      durationSeconds,
    );
  } catch (err) {
    log.error({ err, videoId }, "video pipeline failed");
    // markFailed flips status → 'failed' and emits `video.failed` (terminal).
    const reason = err instanceof Error ? err.message : String(err);
    await deps.store
      .markFailed(ctx, videoId, reason)
      .catch(() => undefined);
  }
}

/**
 * Default runner: fire-and-forget. Kicks the pipeline off without blocking the
 * HTTP response, so `POST /videos` returns immediately with `status:'uploaded'`
 * and the asset transitions to `ready` in the background. Real queue infra is a
 * follow-up behind this same interface.
 */
export class InlinePipelineRunner implements PipelineRunner {
  constructor(private readonly deps: PipelineDeps) {}
  run(ctx: TenantContext, videoId: string): void {
    void runPipeline(this.deps, ctx, videoId);
  }
}

/**
 * Awaitable runner: runs the pipeline synchronously so tests can assert the
 * terminal `ready` state deterministically after `app.inject`.
 */
export class SyncPipelineRunner implements PipelineRunner {
  constructor(private readonly deps: PipelineDeps) {}
  async run(ctx: TenantContext, videoId: string): Promise<void> {
    await runPipeline(this.deps, ctx, videoId);
  }
}
