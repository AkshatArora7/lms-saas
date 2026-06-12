# content service

- **Port (dev):** 4006
- **Data shape:** JSONB + Blob
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Course content tree (modules/lessons/topics), completion tracking, SCORM/xAPI packages, H5P-style interactive content.

## Owned tables

`content_module`, `content_topic`, `content_completion`, `scorm_package`, `xapi_statement`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/courses/{id}/modules` | Ordered module/topic tree. |
| `POST` | `/topics/{id}/complete` | Record completion (emits content.completed). |
| `POST` | `/scorm/packages` | Ingest a SCORM package -> Blob + manifest. |
| `POST` | `/xapi/statements` | Receive xAPI statements (forward to analytics LRS). |

## Events published

- `content.viewed`
- `content.completed`
- `scorm.attempt.recorded`

## Events consumed

- `course.copied (clone module tree)`
- `release.condition.evaluated`

## Dependencies

- Vercel Blob (package/media storage)
- analytics (xAPI forward)
- course (release rules)

## Notes

Large binaries in Blob; structure/metadata in JSONB. xAPI statements are mirrored to analytics.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
