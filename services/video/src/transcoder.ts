/** A single adaptive-streaming rendition (manifest/stream URL on Blob/CDN). */
export interface Rendition {
  quality: "480p" | "720p" | "1080p" | string;
  url: string;
  type: "hls" | "dash" | "mp4";
}

/** A caption/subtitle track. `kind:"auto"` from the Captioner; `"manual"` via PATCH. */
export interface CaptionTrack {
  /** BCP-47 language tag, e.g. "en". */
  lang: string;
  label: string;
  /** WebVTT URL on Blob/CDN. */
  url: string;
  kind: "auto" | "manual";
}

/** Minimal asset view the pipeline seams operate on. */
export interface PipelineAsset {
  id: string;
  tenantId: string;
  title: string;
  sourceBlobUrl: string;
}

/**
 * Transcodes a source video into an adaptive rendition ladder. The interface is
 * the seam that keeps the service offline-testable: production wires a real
 * FFmpeg worker (follow-up) behind it; the default {@link StubTranscoder}
 * derives a deterministic ladder with no network/FFmpeg so tests and CI run
 * offline. Mirrors the ADR-0028 `Embedder`/`ChatModel` precedent.
 */
export interface Transcoder {
  transcode(
    asset: PipelineAsset,
  ): Promise<{ renditions: Rendition[]; durationSeconds: number }>;
}

/**
 * Derive the blob "directory" of a source URL — strip the final filename
 * segment so renditions/captions sit alongside the source object.
 */
export function blobBase(sourceBlobUrl: string): string {
  const idx = sourceBlobUrl.lastIndexOf("/");
  return idx === -1 ? sourceBlobUrl : sourceBlobUrl.slice(0, idx);
}

/** FNV-1a hash of a string → unsigned 32-bit integer (deterministic). */
function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const LADDER: ReadonlyArray<Rendition["quality"]> = ["480p", "720p", "1080p"];

/**
 * Deterministic offline transcoder. Derives a stub HLS adaptive ladder
 * (480p/720p/1080p `.m3u8` manifests) from the source blob URL and a stable
 * `durationSeconds` hashed from the asset id — no FFmpeg, no network — so the
 * upload→ready flow is fully exercisable in tests/CI. The real FFmpeg worker is
 * a follow-up behind this same interface.
 */
export class StubTranscoder implements Transcoder {
  async transcode(
    asset: PipelineAsset,
  ): Promise<{ renditions: Rendition[]; durationSeconds: number }> {
    const base = blobBase(asset.sourceBlobUrl);
    const renditions: Rendition[] = LADDER.map((quality) => ({
      quality,
      url: `${base}/${quality}.m3u8`,
      type: "hls",
    }));
    // Stable pseudo-duration in [60, 3660) seconds, derived from the asset id.
    const durationSeconds = 60 + (hashString(asset.id) % 3600);
    return { renditions, durationSeconds };
  }
}
