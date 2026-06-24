# ADR-0036 — Production video-pipeline providers: shared `@lms/blob`, FFmpeg transcoder, Groq captioner behind the existing seams (env-gated, offline by default)

- **Status:** Accepted · 2026-06-24
- **Issue:** #317 — feat(platform): production Vercel Blob signer shared by content + video (epic: production video pipeline #315 / #316 / #320)
- **Owning scope:** `packages/blob` (new shared package), `services/video`, `services/content`, `packages/config` — docs
- **Author:** Architect agent (recorded by docs-agent)

## Context

[ADR-0029](ADR-0029-video-upload-transcode-pipeline.md) established the video
pipeline as a set of **injectable seams** — `BlobSigner` (storage),
`Transcoder`, `Captioner`, and `PipelineRunner` — each with a deterministic,
offline default (`DevBlobSigner`, `StubTranscoder`, `StubCaptioner`,
`InlinePipelineRunner`). That design deliberately deferred the real providers as
non-blocking follow-ups (ADR-0029 §"Future work"), keeping the service key-free,
FFmpeg-free, and offline so CI/dev boot and the unit suite run with no token, no
network, and no native worker.

This ADR records the concrete **production** providers chosen behind those same
seams. The non-negotiable constraint from ADR-0029 carries forward unchanged:
**tests and CI must keep running offline with no API key, no network, and no
FFmpeg**, and the seam contracts must not break. Every production provider is
therefore **env-gated** — selected only when its credential/flag is set, with the
existing offline stub as the default. This mirrors the [ADR-0028](ADR-0028-ai-rag-study-assistant.md)
`makeChatModel(config)` precedent (real Groq when `GROQ_API_KEY` is set, else
`FakeChatModel`).

The seam interface for storage was previously **duplicated** in
`services/video/src/blob.ts` and `services/content/src/blob.ts` (identical
`BlobSigner` / `SignedUpload {key, uploadUrl, blobUrl}` shape). A real provider
carries secret-handling plus the `@vercel/blob` dependency; duplicating that
across two services would double the secret-touching surface and risk drift.

## Decision

### 1. Storage: new shared `@lms/blob` package (#317)

The signer seam and its types are extracted into a new shared package
`@lms/blob` (mirroring how `@lms/ratelimit` and `@lms/events` are shared), and
both `content` and `video` import it. The package exports:

- `interface SignedUpload { key; uploadUrl; blobUrl }` and
  `interface BlobSigner { sign(key, contentType): SignedUpload }` — moved
  verbatim; **the seam stays SYNCHRONOUS and the 3-field shape is UNCHANGED.**
- `class DevBlobSigner` — the offline default, moved verbatim from both services.
- `class VercelBlobSigner` — production signer for **Vercel Blob**, token in
  constructor. Its `sign()` stays synchronous and does **no** network call and
  **no** SDK import: it derives the stable public host from the store id embedded
  in the read-write token via a pure regex parse (`vercelStoreId(token)`), builds
  `blobUrl = https://<storeId>.public.blob.vercel-storage.com/<key>`, and sets
  `uploadUrl` to the Vercel client-upload endpoint.
- `function makeBlobSigner(config): BlobSigner` — returns `VercelBlobSigner` when
  `config.BLOB_READ_WRITE_TOKEN` is set, else `DevBlobSigner`. Wired in both
  `services/video/src/main.ts` and `services/content/src/main.ts` as
  `options.blobSigner ?? makeBlobSigner(config)`.
- `async function putObject(config, key, body, contentType): Promise<{ url }>` —
  the **write** helper for pipeline artifacts (HLS renditions, VTT captions). It
  lazily `import()`s `@vercel/blob` and calls server-side `put(...)` (async,
  bytes-in-hand); token-gated, throwing a clear error if no token is configured.
  This is the single secret-touching blob-write layer that #315 and #316 reuse.

**Why `sign()` grants no write capability.** ADR-0029 §2 rejected proxying
bytes through the Node process; `sign()` only hands the client *coordinates*
(`{key, uploadUrl, blobUrl}`), never write authority. The async browser
client-upload token (`generateClientTokenFromReadWriteToken`, which is **async**
in the pinned `@vercel/blob@0.27.x` and a pure JWT mint) is therefore **deferred
to the #320 UI story** — it cannot run inside the synchronous `sign()` and is not
needed for the backend slice. No optional `clientToken?` field was added to
`SignedUpload`; the three fields keep their meaning, so existing callers in
`routes.ts` / `store.ts` are unaffected.

The per-service `videoBlobKey` / `blobKey`, `validateUpload`, and
`ALLOWED_CONTENT_TYPES` stay **local** to each service — they encode
service-specific key prefixes and limits. Only the signer + signer types and the
shared `putObject` move into `@lms/blob`.

### 2. Transcode: `FfmpegTranscoder` behind `Transcoder` (#315)

A real `FfmpegTranscoder` drops in behind the existing `Transcoder` interface
(`transcode(asset) → { renditions, durationSeconds }` — unchanged). It is
env-gated by `VIDEO_TRANSCODER=ffmpeg`; the deterministic `StubTranscoder`
(ADR-0029 §3) remains the default when the flag is unset, so CI/dev stay
FFmpeg-free. The transcoded HLS rendition ladder is uploaded to Blob via the
shared `putObject` write helper; the resulting manifest URLs populate
`video_asset.renditions` exactly as today.

### 3. Captions: `GroqCaptioner` behind `Captioner` (#316)

A real `GroqCaptioner` (Groq Whisper ASR) drops in behind the existing
`Captioner` interface (`caption(asset) → CaptionTrack[]` — unchanged),
env-gated by `VIDEO_CAPTIONER=groq` and gated on `GROQ_API_KEY` (mirroring
ADR-0028). The deterministic `StubCaptioner` remains the default. The generated
WebVTT is uploaded to Blob via `putObject`; the auto track is stamped
`kind:"auto"`. The existing manual-edit path —
`PATCH /videos/:id/captions` full-replacing with `kind:"manual"` tracks
(ADR-0029 §2) — is retained unchanged.

### 4. UI: teacher upload + student player (#320)

A teacher upload screen and a student hls.js player are built in the web app,
consuming the gateway's existing `/api/video/*` routes. This story owns the
async browser client-upload token deferred from #317 (§1), which **must** be
scoped to the single tenant-namespaced `pathname` (`t/{tenantId}/…`, derived
server-side from the resolved tenant, never client input) and short-lived.

### Build order

**317 → (315 ∥ 316) → 320.** #317 lands the blob read+write layer (signer +
`putObject`) that both workers and the UI depend on; #315 (transcode) and #316
(captions) can then proceed in parallel; #320 (UI) consumes the finished
backend.

## Consequences

- **Offline-by-default is preserved.** With no `BLOB_READ_WRITE_TOKEN`,
  `VIDEO_TRANSCODER`, or `VIDEO_CAPTIONER` set, both services boot and the full
  unit suite passes with no token, no network, and no FFmpeg — `makeBlobSigner`
  falls back to `DevBlobSigner`, and the stub transcoder/captioner stay the
  default. `@vercel/blob` is lazy-imported only inside `putObject`, so it never
  loads on the boot/test path.
- **Secrets come from validated config only.** `BLOB_READ_WRITE_TOKEN` and
  `GROQ_API_KEY` are read solely from the typed `AppConfig` (`packages/config`),
  never from raw `process.env` in the providers, and are never logged or
  interpolated into URLs, keys, or error messages.
- **Tenant-namespaced keys remain the isolation boundary.** Keys are still built
  server-side from `ctx.tenantId` (`t/{tenantId}/…`), never client-claimed;
  `sign()` does pure string work and broadens no scope. The production providers
  change *where bytes land*, not *who can reach a tenant's prefix*.
- **Per-provider env switches** let storage, transcode, and captioning each be
  enabled independently in production while the rest stay on offline stubs.
- **#315 and #316 share one secret-touching write layer** (`putObject`) instead
  of each re-implementing Vercel calls, minimizing the secret-handling surface.
- **Data-residency note (Groq captioner, #316):** `GroqCaptioner` sends lecture
  audio to Groq for transcription. The data-residency / processing-location
  review for that audio is owned by the #316 handshake's security review, not
  this ADR.
- **Caret-ranged 0.x dependency.** `@vercel/blob@^0.27.0` (resolved 0.27.3) is a
  first-party SDK on a 0.x line where minors may carry breaking changes;
  acceptable because CI installs `--frozen-lockfile` (pinned) and the SDK is
  reached only on the env-gated prod write path.

## Alternatives considered

- **(A) Extend ADR-0029 in place** — rejected: ADR-0029 records the *seam* design
  and its offline stubs; the concrete production providers (and the new shared
  package) are a distinct decision worth its own record, consistent with the ADR
  history.
- **(B) A server-side `put()` inside `sign()`** — rejected: `put()` is async and
  needs the bytes in hand, which would force buffering the (up to 5 GB) upload
  through the Node process — the exact anti-pattern ADR-0029 §2 rejects — and
  would make the seam async. The synchronous client-upload-coordinates flow keeps
  the contract intact.
- **(C) Duplicate the production signer in both services** — rejected: it would
  double the secret-touching surface and `@vercel/blob` dependency and invite
  drift. Sharing via `@lms/blob` mirrors `@lms/ratelimit` / `@lms/events`.
- **(D) Add an optional `clientToken?` to `SignedUpload` now** — rejected: the
  client-token mint is async and lives in the #320 browser-upload path, not the
  synchronous `sign()`, so there is nothing to attach in the backend slice.
