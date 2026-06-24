/**
 * Real FFmpeg transcode worker (#315) behind the {@link Transcoder} seam. It
 * downloads the source object, probes its real duration + height with ffprobe,
 * transcodes an HLS adaptive ladder (480p/720p/1080p `.m3u8` + `.ts` segments)
 * plus a master `.m3u8`, and uploads every artifact to blob storage UNDER the
 * source object's tenant-namespaced prefix (`t/{tenantId}/video/{id}/...`) so
 * isolation is preserved — renditions can never land outside the tenant prefix.
 *
 * The bundled FFmpeg/FFprobe binaries (`ffmpeg-static`/`ffprobe-static`) and the
 * `@lms/blob` write path are imported **lazily** inside `transcode()` — exactly
 * like `groqChatModel`'s lazy `groq-sdk` import — so importing this module pulls
 * no binary and needs no token/network at load/boot/test time. The deterministic
 * offline {@link StubTranscoder} stays the default; this worker is selected only
 * when `VIDEO_TRANSCODER=ffmpeg` (and runs only on the env-gated blob path).
 *
 * DASH is intentionally NOT produced here: HLS is the must-have the seam/UI
 * consume (renditions carry `type:"hls"`); DASH is a follow-up (handshake §6).
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { putObject } from "@lms/blob";
import type { AppConfig } from "@lms/config";

import type { PipelineAsset, Rendition, Transcoder } from "./transcoder.js";

/** One rung of the adaptive ladder: target height + the FFmpeg/HLS bitrate. */
export interface LadderRung {
  quality: "480p" | "720p" | "1080p";
  height: number;
  /** Target average video bitrate in kbps (used in the master BANDWIDTH hint). */
  bitrateKbps: number;
}

/** The full adaptive ladder, ordered low→high. Never upscales the source. */
export const FULL_LADDER: ReadonlyArray<LadderRung> = [
  { quality: "480p", height: 480, bitrateKbps: 1400 },
  { quality: "720p", height: 720, bitrateKbps: 2800 },
  { quality: "1080p", height: 1080, bitrateKbps: 5000 },
];

/**
 * Select the ladder rungs to produce for a source of the given height. Pure and
 * total: keeps every rung at or below the source height (never upscales), and
 * always keeps at least the lowest rung so a tiny/unknown source still yields one
 * rendition. `sourceHeight <= 0` (unknown) falls back to the lowest rung only.
 */
export function selectLadder(sourceHeight: number): LadderRung[] {
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    return [FULL_LADDER[0]!];
  }
  const fits = FULL_LADDER.filter((rung) => rung.height <= sourceHeight);
  return fits.length > 0 ? fits : [FULL_LADDER[0]!];
}

/**
 * Derive the tenant-namespaced blob KEY prefix for an asset's artifacts from its
 * TRUSTED identity — `asset.tenantId` + `asset.id` — to the canonical
 * `t/{tenantId}/video/{id}` directory (mirroring `videoBlobKey`'s convention,
 * `blob.ts`). This is the ONLY value used to key artifact WRITES: it is bound to
 * the server-side asset row, never to the client-supplied `sourceBlobUrl`, so a
 * crafted source URL (e.g. one pointing at `t/{otherTenant}/video/...` or using
 * `../` traversal) can never cause renditions/segments/manifests to land outside
 * the caller's own tenant prefix — the storage isolation boundary. Pure & total.
 */
export function tenantArtifactKeyPrefix(tenantId: string, id: string): string {
  return `t/${tenantId}/video/${id}`;
}

/**
 * Derive the tenant-namespaced blob KEY prefix for an asset's artifacts from its
 * source URL. Source keys are `t/{tenantId}/video/{id}/{filename}` (see
 * `videoBlobKey`); this strips the scheme/host and the trailing filename so
 * renditions/manifests are keyed under the SAME `t/{tenantId}/video/{id}`
 * directory — the storage isolation boundary. Pure and total.
 *
 * Falls back to slicing off the last path segment when no `t/{tenantId}/video/`
 * marker is present (defensive; production URLs always carry it).
 *
 * NOTE: This URL-parsing helper is NOT used to key artifact writes — the
 * client-supplied `sourceBlobUrl` is untrusted, so writes use the trusted
 * {@link tenantArtifactKeyPrefix} instead. Retained for diagnostics/tests.
 */
export function artifactKeyPrefix(sourceBlobUrl: string): string {
  let path = sourceBlobUrl;
  // Strip scheme + host if present (leave bare keys untouched).
  const schemeIdx = path.indexOf("://");
  if (schemeIdx !== -1) {
    const afterScheme = path.slice(schemeIdx + 3);
    const firstSlash = afterScheme.indexOf("/");
    path = firstSlash === -1 ? "" : afterScheme.slice(firstSlash + 1);
  }
  // Drop any query/fragment.
  path = path.split(/[?#]/)[0] ?? "";
  const lastSlash = path.lastIndexOf("/");
  // No slash → no directory → empty prefix (artifact keyed at the root).
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

/**
 * Build a master HLS playlist referencing each variant manifest. Pure: takes the
 * produced rungs (with their relative variant filenames) and emits a valid
 * `#EXT-X-STREAM-INF` master. Ordered as given (low→high).
 */
export function buildMasterPlaylist(
  variants: ReadonlyArray<{ rung: LadderRung; manifestName: string }>,
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const { rung, manifestName } of variants) {
    const bandwidth = rung.bitrateKbps * 1000;
    const width = Math.round((rung.height * 16) / 9);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${rung.height}`,
    );
    lines.push(manifestName);
  }
  return lines.join("\n") + "\n";
}

/** Content type for a produced artifact, keyed off its extension. */
function contentTypeFor(name: string): string {
  if (name.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (name.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

/**
 * Resolve the bundled FFmpeg binary path (lazy). `ffmpeg-static` is a CJS module
 * whose `module.exports` is the path string (typed via a synthetic default); the
 * NodeNext interop nests it one level, so we normalise `default.default ??
 * default` to the actual `string | null` regardless of how the namespace lands.
 */
async function resolveFfmpegPath(): Promise<string> {
  const mod = await import("ffmpeg-static");
  const value = mod.default as unknown as { default?: string } | string | null;
  const path =
    typeof value === "string" ? value : (value?.default ?? null);
  if (!path) {
    throw new Error("ffmpeg-static did not resolve a bundled FFmpeg binary");
  }
  return path;
}

/** Resolve the bundled FFprobe binary path (lazy named `path` export). */
async function resolveFfprobePath(): Promise<string> {
  const { path } = await import("ffprobe-static");
  if (!path) {
    throw new Error("ffprobe-static did not resolve a bundled FFprobe binary");
  }
  return path;
}

/** Run a binary to completion, capturing stdout; rejects on non-zero exit. */
function run(
  bin: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/** ffprobe → { durationSeconds, height } for a local file. */
async function probe(
  ffprobePath: string,
  file: string,
): Promise<{ durationSeconds: number; height: number }> {
  const { stdout } = await run(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; height?: number }>;
  };
  const durationSeconds = Math.round(Number(parsed.format?.duration ?? 0));
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const height = Number(video?.height ?? 0);
  return { durationSeconds, height };
}

/**
 * Production FFmpeg transcoder. See module docs. Reads its blob token only from
 * the validated {@link AppConfig} (via `@lms/blob` `putObject`).
 */
export class FfmpegTranscoder implements Transcoder {
  constructor(private readonly config: AppConfig) {}

  async transcode(
    asset: PipelineAsset,
  ): Promise<{ renditions: Rendition[]; durationSeconds: number }> {
    const ffmpegPath = await resolveFfmpegPath();
    const ffprobePath = await resolveFfprobePath();
    const workDir = await mkdtemp(join(tmpdir(), "lms-transcode-"));
    try {
      // 1. Download the source object to a temp file.
      const sourceFile = join(workDir, "source");
      const res = await fetch(asset.sourceBlobUrl);
      if (!res.ok) {
        throw new Error(
          `failed to download source (${res.status} ${res.statusText})`,
        );
      }
      const sourceBytes = Buffer.from(await res.arrayBuffer());
      await writeFile(sourceFile, sourceBytes);

      // 2. Probe real duration + height.
      const { durationSeconds, height } = await probe(ffprobePath, sourceFile);

      // 3. Transcode each ladder rung to its own HLS variant. The artifact
      // write key prefix is bound to the asset's TRUSTED identity
      // (tenantId + id), NOT the client-supplied source URL, so a crafted
      // sourceBlobUrl can never write outside the caller's tenant prefix.
      const keyPrefix = tenantArtifactKeyPrefix(asset.tenantId, asset.id);
      const rungs = selectLadder(height);
      const variants: Array<{ rung: LadderRung; manifestName: string }> = [];
      const renditions: Rendition[] = [];

      for (const rung of rungs) {
        const manifestName = `${rung.quality}.m3u8`;
        const segmentPattern = join(workDir, `${rung.quality}_%03d.ts`);
        const manifestPath = join(workDir, manifestName);
        await run(ffmpegPath, [
          "-y",
          "-i",
          sourceFile,
          "-vf",
          `scale=-2:${rung.height}`,
          "-c:v",
          "libx264",
          "-b:v",
          `${rung.bitrateKbps}k`,
          "-c:a",
          "aac",
          "-hls_time",
          "6",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_filename",
          segmentPattern,
          manifestPath,
        ]);

        // Upload the variant manifest + its segments under the tenant prefix.
        const variantUrl = await this.uploadArtifact(
          keyPrefix,
          manifestName,
          await readFile(manifestPath),
        );
        await this.uploadSegments(workDir, keyPrefix, rung.quality, manifestPath);

        variants.push({ rung, manifestName });
        renditions.push({ quality: rung.quality, url: variantUrl, type: "hls" });
      }

      // 4. Build + upload the master manifest; expose it as a rendition too.
      const master = buildMasterPlaylist(variants);
      const masterUrl = await this.uploadArtifact(
        keyPrefix,
        "master.m3u8",
        Buffer.from(master, "utf8"),
      );
      renditions.push({ quality: "auto", url: masterUrl, type: "hls" });

      return { renditions, durationSeconds };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Upload one artifact under `{keyPrefix}/{name}` and return its blob URL. */
  private async uploadArtifact(
    keyPrefix: string,
    name: string,
    body: Buffer,
  ): Promise<string> {
    const key = keyPrefix ? `${keyPrefix}/${name}` : name;
    const { url } = await putObject(this.config, key, body, contentTypeFor(name));
    return url;
  }

  /** Upload every `.ts` segment named in a variant manifest under the prefix. */
  private async uploadSegments(
    workDir: string,
    keyPrefix: string,
    quality: string,
    manifestPath: string,
  ): Promise<void> {
    const manifest = await readFile(manifestPath, "utf8");
    const segments = manifest
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#") && l.endsWith(".ts"));
    for (const seg of segments) {
      // Defensive: only upload the segments this rung produced.
      if (!seg.startsWith(`${quality}_`)) continue;
      await this.uploadArtifact(keyPrefix, seg, await readFile(join(workDir, seg)));
    }
  }
}
