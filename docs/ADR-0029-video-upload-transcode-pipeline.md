# ADR-0029 — Video upload->transcode pipeline: injectable Transcoder/Captioner/PipelineRunner seams, URL-based playback, per-tenant access control

- **Status:** Accepted · 2026-06-21
- **Issue:** #67 — Upload and stream lecture video (epic #66)
- **Owning scope:** `services/video` (bounded context) — docs
- **Author:** Architect agent (recorded by docs-agent)

## Context

The `video` service was a health-only stub (`GET /health` + a `// TODO: register
domain routes`, port 4020). Issue #67 asks it to become a real bounded context: a
teacher uploads a lecture video (signed direct-to-Blob upload, tenant-namespaced),
an asynchronous pipeline transcodes it into an adaptive rendition ladder and
generates captions, and students stream it back — all **tenant-isolated** by the
platform's existing Postgres RLS. The three acceptance criteria are: async
transcode to adaptive renditions; auto-captions with manual edit; per-tenant
storage and access control.

The schema already provided the data model (`database/schema.sql:1014`):
`video_asset(id, tenant_id->tenant, owner_id->app_user (ON DELETE SET NULL,
nullable), title, source_blob_url NOT NULL, status CHECK IN
('uploaded','transcoding','ready','failed') DEFAULT 'uploaded', renditions jsonb
DEFAULT '[]', captions jsonb DEFAULT '[]', duration_seconds int, created_at)`,
index `ix_video_tenant(tenant_id)`. RLS is already wired
(`database/policies/rls.sql:31`): `video_asset` sits in the `tenant_tables` loop
that runs `ENABLE` + `FORCE ROW LEVEL SECURITY` and creates the `tenant_isolation`
policy `USING/WITH CHECK (tenant_id = current_tenant_id())` — so **no schema change
was required** and **no `course_id` column exists**.

Two real constraints shaped the design, mirroring the ADR-0028 precedent:

1. **Real FFmpeg transcoding and ASR auto-captioning cannot run in-process or
   offline.** FFmpeg is a heavy native worker (and runs on a container host, not
   serverless, due to runtime limits); ASR needs a hosted model. Neither can run
   inside the Fastify request path, and neither can run in CI.
2. **Tests and CI must run offline with no API key, no network, no FFmpeg, and no
   DB.** The repo's verification gates (`qa-agent`) run key-free; a service that
   hard-depended on a live transcoder/ASR provider at import or boot time would
   break them.

## Decision

### 1. Bounded context + signed blob upload (tenant-namespaced)

The `video` service owns `video_asset` and exposes its surface behind the gateway
as `/api/video/*` (port 4020). Tenant comes from the gateway's trusted
`x-tenant-id` (`headerTenantResolver` -> 400 `tenant_required` if absent); caller
identity from the trusted `x-user-id` / `x-user-roles` (see
[ADR-0027](ADR-0027-trusted-identity-headers.md)) -> 401 `user_required` if
`x-user-id` is absent.

Upload reuses the **content service's `BlobSigner` seam** verbatim, but with a
distinct, video-specific object-key prefix so the two surfaces can never collide:
`videoBlobKey(tenantId, id, filename)` = `t/{tenantId}/video/{id}/{safeName}`. The
per-tenant prefix is the **storage isolation boundary**; the `{id}` segment is a
server-generated `randomUUID()`, and the client supplies only the leaf filename,
which is sanitized (`safeName` — basename only, `[A-Za-z0-9._-]` allow-list, 128
chars). `POST /uploads {filename, contentType, sizeBytes}` validates then returns
**201** `{upload:{key, uploadUrl, blobUrl}}`; the client PUTs the bytes straight
to object storage and then calls `POST /videos` with the returned `blobUrl`.

The default signer is the deterministic `DevBlobSigner` (dev/test); a production
Vercel Blob signer drops in behind the same `BlobSigner` interface (follow-up). No
`@vercel/blob` dependency was added in this story.

### 2. Playback contract — return URLs, never proxy bytes

`GET /videos/:id` returns the **rendition manifest URLs** (`renditions`) +
`source_blob_url` + `captions`; the service never streams video bytes through
Fastify. The web player points `<video>`/hls.js at the rendition URLs and a
`<track>` at each caption URL; streaming bandwidth is served by Blob/CDN, not the
Node process.

- **`renditions` jsonb shape:** `Rendition = { quality: "480p"|"720p"|"1080p"|
  string, url: string (HLS/DASH manifest or mp4 URL on Blob/CDN), type:
  "hls"|"dash"|"mp4" }`. The default ladder is the three-rung HLS ladder
  (`480p/720p/1080p` `.m3u8`).
- **`captions` jsonb shape:** `CaptionTrack = { lang: string (BCP-47, e.g. "en"),
  label: string, url: string (WebVTT URL on Blob/CDN), kind: "auto"|"manual" }`.
  The auto track from the Captioner is `kind:"auto"`; `PATCH /videos/:id/captions`
  full-replaces with tracks stamped `kind:"manual"`.

Rationale: scalable and matches the Blob+CDN delivery intent; proxying lecture
video through a Fastify service is a non-starter at scale.

### 3. Injectable async pipeline seams (offline-testable by construction)

Three seams are interfaces so the service is key-free, FFmpeg-free, and offline by
default, and real workers can drop in later behind env with no caller changes.
This mirrors the ADR-0028 `Embedder`/`ChatModel` precedent exactly.

```ts
// transcoder.ts
export interface Transcoder { transcode(asset: PipelineAsset): Promise<{ renditions: Rendition[]; durationSeconds: number }>; }
// captioner.ts
export interface Captioner { caption(asset: PipelineAsset): Promise<CaptionTrack[]>; }
// pipeline.ts
export interface PipelineRunner { run(ctx: TenantContext, videoId: string): void | Promise<void>; }
```

- **Default `Transcoder` = deterministic `StubTranscoder`** (offline, no
  FFmpeg/network): derives a stub HLS adaptive ladder from `source_blob_url` —
  `[{quality:"480p",type:"hls",url:`${base}/480p.m3u8`}, 720p, 1080p]` — and a
  stable `durationSeconds` (FNV-1a hash of the asset id, in `[60, 3660)`). The real
  FFmpeg worker is a follow-up behind this same interface.
- **Default `Captioner` = deterministic `StubCaptioner`**: returns one
  `{lang:"en", label:"English (auto)", url:`${base}/captions/en.vtt`, kind:"auto"}`.
  Real ASR auto-captioning is a follow-up behind this same interface.
- **Async execution model — the `PipelineRunner` seam:**
  - **Default `InlinePipelineRunner` (fire-and-forget):** on `POST /videos` (and
    `POST /videos/:id/transcode`) it kicks off the pipeline without blocking the
    HTTP response — `setStatus(transcoding)`, run `Transcoder` + `Captioner`
    concurrently, then persist `renditions`/`captions`/`duration_seconds` and flip
    `status='ready'` (or `'failed'` on any throw), **each store step inside its own
    `withTenant(ctx, ...)`**. This models "async" honestly without standing up
    queue infra; real queue/worker infra is a follow-up behind the same interface.
  - **`SyncPipelineRunner` (tests):** runs the pipeline synchronously so
    `app.inject` assertions are deterministic (await create -> `GET` shows
    `status:'ready'` with the stub ladder + auto caption + duration). Tests wire
    `MemoryVideoStore` + `StubTranscoder` + `StubCaptioner` + the sync runner —
    fully offline.

The status lifecycle is `uploaded -> transcoding -> ready` (or `-> failed`),
matching the `video_asset.status` CHECK constraint.

### 4. Tenant isolation (ADR-0026) + access control (AC#3)

Tenant isolation is the sacred boundary and is unchanged from the platform model.
The runtime connects as `app_user` (`NOBYPASSRLS`, see
[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)); `video_asset` has
`FORCE ROW LEVEL SECURITY` + the `tenant_isolation` policy; and **every**
`VideoStore` method — create, list, get, status/renditions/captions updates — runs
inside `withTenant(ctx, ...)`. `tenant_id` is never accepted from the client: it is
stamped from `ctx.tenantId` on INSERT and RLS-enforced on read/update. Blob keys
are tenant-namespaced (`t/{tenantId}/video/...`) as the storage isolation boundary.

Write authz mirrors the analytics `Caller{userId, roles}` pattern from the trusted
`x-user-id` / `x-user-roles` (ADR-0027):

- `POST /uploads` + `POST /videos` require an **uploader role**
  (`VIDEO_UPLOADER_ROLES` = `super_admin`, `org_admin`, `instructor`, `teacher`,
  `teaching_assistant`) -> else **403 `forbidden`**.
- `POST /videos/:id/transcode` + `PATCH /videos/:id/captions` require the **owner**
  (`video_asset.owner_id === caller.userId`) **or** an admin
  (`super_admin`/`org_admin`) -> else **403**. `owner_id` is set from the trusted
  `x-user-id` and ownership is read under RLS, never client-claimed.
- **Read** (`GET /videos`, `GET /videos/:id`) is any authenticated tenant member,
  RLS-scoped — tenant isolation is the access boundary for reads this story.

**`course_id` / course-scoped streaming — deliberately deferred.** `video_asset`
has no `course_id`; per-tenant + owner/admin-write + tenant-member-read fully
satisfies AC#3 ("per-tenant storage & access control"). Course/enrollment-scoped
streaming (only enrolled students of the course a video belongs to) is a deliberate
scope cut — it would need a `course_id` column + a schema-agent step, with RLS
staying tenant-scoped — and is recorded as a follow-up.

### 5. Upload safety

`validateUpload` enforces a content-type **allow-list**
(`ALLOWED_CONTENT_TYPES` = `video/mp4`, `video/webm`, `video/quicktime`,
`video/x-matroska`) -> **415 `unsupported_type`**, and a size cap
(`DEFAULT_MAX_UPLOAD_BYTES` = 5 GB, overridable via `maxUploadBytes`) -> **413
`too_large`**. Filenames are sanitized to a safe object-key segment (`safeName`:
basename only, non-`[A-Za-z0-9._-]` replaced with `_`, capped at 128 chars), so a
malicious filename cannot inject path segments or escape the
`t/{tenantId}/video/{uuid}/` prefix.

## Consequences

- **The service is key-free, FFmpeg-free, and offline by default.** It boots and
  its full unit suite (17/17) passes with no FFmpeg, ASR, network, or DB, because
  all three pipeline seams have deterministic offline defaults. Adding a real
  transcoder/ASR/blob signer is purely additive behind the existing interfaces.
- **Cross-tenant access is impossible by construction.** Every store method runs
  under FORCE RLS + `withTenant`; a two-tenant test proves tenant B sees an empty
  list, 404 on read/transcode of tenant A's asset, while tenant A still lists 1.
- **Streaming scales with the CDN, not the Node service** — the service only ever
  returns URLs.
- **No domain events yet.** This slice is HTTP request/response only; the service
  publishes/consumes nothing on the outbox/inbox and is not wired into `relay`.
  Emitting `video.ready`/`video.failed` is a follow-up.
- **The default pipeline runner is fire-and-forget with no rate limit or cost
  ceiling** — acceptable while the workers are deterministic stubs, but it must be
  bounded (per-tenant quota / a job queue with concurrency caps) before a real
  FFmpeg/ASR worker lands.

## Future work (non-blocking follow-ups)

- **Real FFmpeg transcode worker** behind the `Transcoder` interface (container
  host, not serverless).
- **Real ASR auto-captioner** behind the `Captioner` interface.
- **Production Vercel Blob signer** behind the `BlobSigner` interface (shared with
  content).
- **Pipeline rate-limit / per-tenant concurrency + cost ceiling**, and a per-tenant
  storage quota, before real workers land.
- **Outbox `video.ready` / `video.failed` events** + `relay` wiring so content /
  notifications can react.
- **Course/enrollment-scoped streaming** (adds `video_asset.course_id` -> a
  schema-agent step) if per-course streaming privacy is later required.
- **Teacher upload UI + student player** (`apps/web`, hls.js against `renditions`,
  `<track>` from `captions`) — deferred; backend-first this story.

## Alternatives considered

- **(A) Proxy/stream video bytes through the service** — rejected: a Fastify
  service streaming lecture video does not scale; Blob/CDN delivery via returned
  URLs is the only viable contract.
- **(B) A mandatory hosted transcoder/ASR as the default** — rejected: it would
  break key-free/offline qa and make the module un-bootable without provider
  credentials. The injectable seams keep the service offline by default with a real
  provider as a drop-in.
- **(C) A real queue/worker (e.g. QStash) in this story** — rejected as scope: the
  `PipelineRunner` seam models async honestly (fire-and-forget) without standing up
  queue infra, and a real queue drops in behind the same interface as a follow-up.
- **(D) Add `course_id` + course-scoped RLS now** — rejected as scope: per-tenant
  isolation satisfies AC#3; course-scoped streaming is a deliberate follow-up that
  needs a schema change.
