# video service

- **Port (dev):** 4020
- **Data shape:** Blob + JSONB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Lecture-video bounded context: signed direct-to-Blob uploads (tenant-namespaced), an injectable async transcode->caption pipeline that drives the video_asset lifecycle (uploaded->transcoding->ready), and URL-based adaptive playback (renditions + captions served from Blob/CDN, never proxied). Tenant-isolated by Postgres RLS.

## Owned tables

`video_asset`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/uploads` | Sign a tenant-namespaced video upload (key `t/{tenantId}/video/{uuid}/{file}`); validates content-type allow-list (415) + size cap (413). Requires an uploader role. Returns {upload:{key,uploadUrl,blobUrl}}. |
| `POST` | `/videos` | Create a video_asset {title, sourceBlobUrl} (owner_id from x-user-id, status='uploaded') and enqueue the transcode->caption pipeline. Requires an uploader role. |
| `GET` | `/videos` | List the tenant's videos, newest first (any tenant member, RLS-scoped). |
| `GET` | `/videos/{id}` | Read one asset -- the playback contract: renditions (HLS ladder URLs) + sourceBlobUrl + captions + status + durationSeconds. 404 if not found. |
| `POST` | `/videos/{id}/transcode` | (Re)run the pipeline for an asset (idempotent: re-advances uploaded/failed -> transcoding -> ready, rewrites renditions+captions). Owner or admin. |
| `PATCH` | `/videos/{id}/captions` | Manual caption edit: full-replace the captions jsonb with validated tracks (stamped kind:'manual'). Owner or admin; 400 on malformed tracks. |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- Vercel Blob (signed upload, DevBlobSigner default; production signer is a follow-up)
- FFmpeg worker (container host; real transcoder is a follow-up behind the Transcoder seam)
- ASR provider (real auto-captioner is a follow-up behind the Captioner seam)

## Notes

Per-tenant isolation: video_asset is under FORCE RLS (tenant_isolation), and every store method runs inside withTenant -- tenant_id is stamped from ctx on INSERT, never client-supplied; blob keys are tenant-namespaced (t/{tenantId}/video/...) as the storage boundary. The heavy work sits behind injectable seams (mirroring ADR-0028): a Transcoder (default deterministic StubTranscoder -> 480p/720p/1080p HLS ladder + hashed duration), a Captioner (default StubCaptioner -> one auto English WebVTT track), and a PipelineRunner (default fire-and-forget InlinePipelineRunner; SyncPipelineRunner for tests) advancing status uploaded->transcoding->ready (or failed) -- so the service boots and tests run offline with no FFmpeg/ASR/network/DB. renditions jsonb = [{quality,url,type:'hls'|'dash'|'mp4'}]; captions jsonb = [{lang,label,url,kind:'auto'|'manual'}]. Playback returns URLs (Blob/CDN streams), never proxies bytes. Write authz via x-user-id/x-user-roles (ADR-0027): uploader role for upload/create, owner-or-admin for transcode/captions; read = any tenant member. Upload safety = content-type allow-list (mp4/webm/quicktime/mkv) + 5 GB cap + filename sanitization. No outbox/inbox events wired yet; course-scoped streaming (needs video_asset.course_id) is a deliberate follow-up. See [ADR-0029](../ADR-0029-video-upload-transcode-pipeline.md).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
