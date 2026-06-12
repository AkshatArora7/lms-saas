# video service

- **Port (dev):** 4020
- **Data shape:** Blob + JSONB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Video upload, FFmpeg transcode to HLS/DASH, caption/transcript generation.

## Owned tables

`video_asset`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/videos` | Initiate upload (returns Blob upload URL). |
| `POST` | `/videos/{id}/transcode` | Enqueue FFmpeg transcode job. |
| `GET` | `/videos/{id}/manifest` | HLS/DASH manifest URL once ready. |

## Events published

- `video.uploaded`
- `video.transcoded`
- `video.captioned`

## Events consumed

- `video.transcode.requested`

## Dependencies

- Vercel Blob
- FFmpeg worker (container host)
- ai (transcription, optional)

## Notes

Transcoding runs on a container worker (not serverless) due to runtime limits; status in JSONB.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
