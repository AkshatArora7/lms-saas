/**
 * Real ASR auto-captioner (#316) behind the {@link Captioner} seam. Generates a
 * timed WebVTT track from the source video using Groq Whisper, then uploads the
 * VTT to object storage and returns an `auto` {@link CaptionTrack} pointing at
 * it. Selected only when `VIDEO_CAPTIONER=groq` AND `GROQ_API_KEY` is set
 * (see `makeCaptioner` in main.ts); the offline {@link StubCaptioner} stays the
 * default so tests/CI run with no key, FFmpeg, or network.
 *
 * The pipeline:
 *   1. Download the source bytes from `asset.sourceBlobUrl` to a temp file.
 *   2. Extract a mono 16 kHz WAV via FFmpeg (Whisper-friendly, small) to a
 *      second temp file. `ffmpeg-static` provides the bundled binary.
 *   3. POST the audio to Groq `audio/transcriptions` (model from config, default
 *      `whisper-large-v3`, `response_format=vtt`) → timed VTT text.
 *   4. Upload the VTT via `@lms/blob` `putObject` under the asset's
 *      tenant-namespaced prefix, keyed PURELY from the trusted server-side
 *      identity (`asset.tenantId`/`asset.id`) — never the client-supplied
 *      `sourceBlobUrl` — preserving storage isolation.
 *
 * `ffmpeg-static` is imported lazily inside `caption()` (dynamic `import()`),
 * exactly like `groqChatModel`'s lazy `groq-sdk` import and `putObject`'s lazy
 * `@vercel/blob` import — so importing this module pulls no binary and needs
 * nothing at boot/test time. The Groq key is read ONLY from the validated
 * {@link AppConfig} and is NEVER logged; audio bytes are never logged either.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { putObject } from "@lms/blob";
import type { AppConfig } from "@lms/config";
import { createLogger } from "@lms/logger";

import type { Captioner } from "./captioner.js";
import { blobBase, type CaptionTrack, type PipelineAsset } from "./transcoder.js";

const log = createLogger("video");

/** Groq's OpenAI-compatible audio transcription endpoint. */
const GROQ_TRANSCRIPTIONS_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Derive the tenant-namespaced object KEY for the auto-caption VTT from the
 * asset's TRUSTED server-side identity (`asset.tenantId` + `asset.id`). Pure and
 * total. Reuses the `t/{tenantId}/video/{id}` directory convention of
 * `videoBlobKey` (`blob.ts:69-75`) and places the VTT under a `captions/`
 * sibling → `t/{tenantId}/video/{id}/captions/en.vtt`. Because the key is built
 * ONLY from trusted identity (never from the client-supplied `sourceBlobUrl`),
 * the upload can NEVER land outside the caller's tenant prefix (the storage
 * isolation boundary). This is the write-path key (mirrors #315's
 * `tenantArtifactKeyPrefix`).
 */
export function tenantCaptionKey(tenantId: string, id: string): string {
  return `t/${tenantId}/video/${id}/captions/en.vtt`;
}

/**
 * DIAGNOSTICS ONLY — do NOT use on the write path. Derives a caption key by
 * string-parsing the (client-supplied) source blob URL: strips the origin
 * (scheme + host) and the final filename segment, then appends `captions/
 * en.vtt`. Because the result echoes whatever prefix the URL encodes, it MUST
 * NOT be used to key a blob WRITE — a crafted `sourceBlobUrl` could redirect the
 * write into another tenant's prefix. Use {@link tenantCaptionKey} for writes.
 * Kept for logging/diagnostics and so the StubCaptioner-style URL shape can be
 * inspected in isolation.
 */
export function captionKey(sourceBlobUrl: string): string {
  // blobBase strips the trailing filename → ".../t/{tenant}/video/{id}".
  const dir = blobBase(sourceBlobUrl);
  // Strip the origin so we hand back a store-relative key, not a URL.
  const withoutScheme = dir.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const firstSlash = withoutScheme.indexOf("/");
  const path = firstSlash === -1 ? withoutScheme : withoutScheme.slice(firstSlash + 1);
  return `${path}/captions/en.vtt`;
}

/**
 * Run a child process to completion, rejecting on a non-zero exit. stderr is
 * captured for the error message only (truncated) and is otherwise discarded —
 * we never log raw audio or full FFmpeg chatter.
 */
function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/**
 * Groq Whisper ASR captioner. Downloads the source, extracts mono 16 kHz audio
 * with FFmpeg, transcribes it via Groq into timed VTT, uploads the VTT to the
 * tenant-namespaced blob prefix, and returns a single `auto` English track.
 * Temp files are always removed in a `finally` block.
 */
export class GroqCaptioner implements Captioner {
  constructor(private readonly config: AppConfig) {}

  async caption(asset: PipelineAsset): Promise<CaptionTrack[]> {
    const stamp = randomUUID();
    const sourcePath = join(tmpdir(), `video-asr-src-${stamp}`);
    const audioPath = join(tmpdir(), `video-asr-audio-${stamp}.wav`);
    try {
      // 1. Download the source bytes to a temp file.
      const res = await fetch(asset.sourceBlobUrl);
      if (!res.ok) {
        throw new Error(`failed to download source (status ${res.status})`);
      }
      const sourceBytes = Buffer.from(await res.arrayBuffer());
      await writeFile(sourcePath, sourceBytes);

      // 2. Extract mono 16 kHz WAV (Whisper-friendly) via the bundled FFmpeg.
      const ffmpegMod = await import("ffmpeg-static");
      const ffmpegBin = (ffmpegMod.default ?? ffmpegMod) as unknown as string;
      if (!ffmpegBin) throw new Error("ffmpeg-static binary not available");
      await run(ffmpegBin, [
        "-y",
        "-i",
        sourcePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        audioPath,
      ]);

      // 3. Transcribe to timed VTT via Groq Whisper.
      const vtt = await this.transcribe(audioPath);

      // 4. Upload the VTT under the asset's tenant-namespaced prefix. The write
      // key is a PURE function of the TRUSTED server-side identity
      // (asset.tenantId/asset.id from the RLS-scoped row), never the
      // client-supplied sourceBlobUrl — so a crafted URL cannot redirect the
      // write into another tenant's prefix (#316 security fix; mirrors #315).
      const key = tenantCaptionKey(asset.tenantId, asset.id);
      const { url } = await putObject(this.config, key, vtt, "text/vtt");

      return [{ lang: "en", label: "English (auto)", url, kind: "auto" }];
    } finally {
      await rm(sourcePath, { force: true }).catch(() => undefined);
      await rm(audioPath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * POST the extracted audio to Groq's `audio/transcriptions` endpoint and
   * return the raw WebVTT body. The API key is read from validated config and
   * sent only as the `Authorization` bearer; it is never logged.
   */
  private async transcribe(audioPath: string): Promise<string> {
    const audio = await readFile(audioPath);
    const form = new FormData();
    form.append("model", this.config.VIDEO_WHISPER_MODEL);
    form.append("response_format", "vtt");
    form.append(
      "file",
      new Blob([audio], { type: "audio/wav" }),
      "audio.wav",
    );

    const res = await fetch(GROQ_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.GROQ_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      // Surface status only — never echo the response body (may include the
      // request payload) or the key.
      log.error({ status: res.status }, "groq transcription request failed");
      throw new Error(`groq transcription failed (status ${res.status})`);
    }
    return res.text();
  }
}
