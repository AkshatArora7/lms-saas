# content service

- **Port (dev):** 4006
- **Data shape:** JSONB + Blob
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Course content tree (modules/lessons/topics), completion tracking, SCORM/xAPI packages, H5P-style interactive content, and authored rich pages (WYSIWYG) with versioned drafts.

## Owned tables

`content_module`, `content_topic`, `content_completion`, `page`, `page_version`, `release_condition`, `scorm_package`, `xapi_statement`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/uploads` | Signed direct-to-Blob upload URL (type/size validated, tenant-namespaced key). |
| `POST` | `/courses/{courseId}/modules` | Create a module. |
| `GET` | `/courses/{courseId}/modules` | Ordered modules for a course. |
| `GET` | `/modules/{id}` | Module with its ordered topics. |
| `POST` | `/modules/{id}/topics` | Add a topic (html/file/link/scorm/lti/video). |
| `POST` | `/courses/{courseId}/release-conditions` | Availability/prerequisite rule (boolean tree). |
| `POST` | `/courses/{courseId}/pages` | Author a rich page (creates the page as a draft + version #1; slug derived from title if omitted). |
| `GET` | `/courses/{courseId}/pages` | List a course's pages (summaries, no body). |
| `GET` | `/pages/{id}` | Page + its current version (latest draft, else published). |
| `PATCH` | `/pages/{id}` | Update title/slug; a new body inserts a NEW draft version (never mutates a prior version). |
| `POST` | `/pages/{id}/publish` | Promote a draft version to published (default target = latest draft); sets the page's published pointer. |
| `GET` | `/pages/{id}/versions` | Version history, newest-first (no body). |
| `GET` | `/pages/{id}/versions/{versionId}` | One full version including its body (read-only view). |

## Events published

_None_

## Events consumed

- `course.copied (clone module tree)`

## Dependencies

- Vercel Blob (package/media storage)
- analytics (xAPI forward)

## Notes

Modules/topics ordered by position; availability/prerequisites modelled via release_condition. Large binaries upload direct-to-Blob via signed URLs (tenant-namespaced keys). Rich pages (#32) are authored in-platform via an accessible WYSIWYG editor: `page` holds identity + the published-version pointer, while immutable append-only `page_version` rows carry the sanitized rich-HTML `body` (versioned drafts). Editing with a new body always inserts the next version rather than mutating an existing one; publishing promotes a chosen draft. Embedded media/files reuse the existing signed `POST /uploads` flow with the blob URL referenced inline in the page HTML (no separate media join). Draft/published state, virus scanning, per-plan size limits, SCORM/xAPI ingestion and completion tracking, and page-version retention/restore are tracked follow-ups.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
