import { blobBase, type CaptionTrack, type PipelineAsset } from "./transcoder.js";

/**
 * Produces caption tracks for a video. The interface is the seam that keeps the
 * service offline-testable: production wires a real ASR provider (follow-up)
 * behind it; the default {@link StubCaptioner} returns a deterministic auto
 * track with no network so tests and CI run offline. Mirrors the ADR-0028
 * `Embedder`/`ChatModel` precedent.
 */
export interface Captioner {
  caption(asset: PipelineAsset): Promise<CaptionTrack[]>;
}

/**
 * Deterministic offline captioner: emits a single auto-generated English track
 * pointing at a stub WebVTT URL alongside the source blob. Real ASR
 * auto-captioning is a follow-up behind this same interface.
 */
export class StubCaptioner implements Captioner {
  async caption(asset: PipelineAsset): Promise<CaptionTrack[]> {
    const base = blobBase(asset.sourceBlobUrl);
    return [
      {
        lang: "en",
        label: "English (auto)",
        url: `${base}/captions/en.vtt`,
        kind: "auto",
      },
    ];
  }
}
