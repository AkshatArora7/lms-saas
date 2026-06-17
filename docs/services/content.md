# content service

- **Port (dev):** 4006
- **Data shape:** JSONB + Blob
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Course content tree (modules/lessons/topics), completion tracking, SCORM/xAPI packages, H5P-style interactive content.

## Owned tables

`content_module`, `content_topic`, `content_completion`, `release_condition`, `scorm_package`, `xapi_statement`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/uploads` | Signed direct-to-Blob upload URL (type/size validated, tenant-namespaced key). |
| `POST` | `/courses/{courseId}/modules` | Create a module. |
| `GET` | `/courses/{courseId}/modules` | Ordered modules for a course. |
| `GET` | `/modules/{id}` | Module with its ordered topics. |
| `POST` | `/modules/{id}/topics` | Add a topic (html/file/link/scorm/lti/video). |
| `POST` | `/courses/{courseId}/release-conditions` | Availability/prerequisite rule (boolean tree). |

## Events published

_None_

## Events consumed

- `course.copied (clone module tree)`

## Dependencies

- Vercel Blob (package/media storage)
- analytics (xAPI forward)

## Notes

Modules/topics ordered by position; availability/prerequisites modelled via release_condition. Large binaries upload direct-to-Blob via signed URLs (tenant-namespaced keys). Draft/published state, virus scanning, per-plan size limits, SCORM/xAPI ingestion and completion tracking are tracked follow-ups.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
