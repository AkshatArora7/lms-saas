# content service

- **Port (dev):** 4006
- **Data shape:** JSONB + Blob
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Course content tree (modules/lessons/topics), completion tracking, SCORM/xAPI packages, H5P-style interactive content, and authored rich pages (WYSIWYG) with versioned drafts.

## Owned tables

`content_module`, `content_topic`, `content_completion`, `page`, `page_version`, `release_condition`, `scorm_package`, `scorm_attempt`, `xapi_statement`

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
| `POST` | `/scorm/packages` | Import a SCORM 1.2/2004 package: parse the supplied imsmanifest.xml (org title, launch href, mastery score) and store a launchable package. 400 `invalid_manifest`/`no_launchable_resource`/`unsafe_href`; 201 `{package}`. |
| `GET` | `/scorm/packages/{id}` | Launch info for a package (version, title, launchHref, masteryScore, blobUrl, topicId, manifest); 404 if not found. |
| `PUT` | `/scorm/packages/{id}/runtime` | Record a learner attempt: normalize raw cmi (SCORM 1.2 lesson_status or 2004 completion/success/score) and upsert one attempt per (tenant, package, learner). On a terminal/passing state emits a `learning.event_captured` outbox row (source:"scorm"). 404 if the package is unknown; 200 `{attempt}`. |
| `GET` | `/scorm/packages/{id}/runtime?learnerId=` | Read back a learner's current attempt for a package (RLS-scoped); 404 if the package is unknown, else 200 `{attempt\|null}`. |

## Events published

- `learning.event_captured`

## Events consumed

- `course.copied (clone module tree)`

## Dependencies

- Vercel Blob (package/media storage)
- analytics (xAPI forward)

## Notes

Modules/topics ordered by position; availability/prerequisites modelled via release_condition. Large binaries upload direct-to-Blob via signed URLs (tenant-namespaced keys). Rich pages (#32) are authored in-platform via an accessible WYSIWYG editor: `page` holds identity + the published-version pointer, while immutable append-only `page_version` rows carry the sanitized rich-HTML `body` (versioned drafts). Editing with a new body always inserts the next version rather than mutating an existing one; publishing promotes a chosen draft. Embedded media/files reuse the existing signed `POST /uploads` flow with the blob URL referenced inline in the page HTML (no separate media join). SCORM import + completion tracking ship now (#31): `POST /scorm/packages` parses the supplied imsmanifest.xml (the .zip uploads via the signed `POST /uploads` flow and its blob URL is stored) into a launchable `scorm_package` (title/launch_href/mastery_score denormalized; full parsed manifest kept in `manifest` jsonb); the runtime endpoints upsert one `scorm_attempt` per (tenant, package, learner) — raw cmi (SCORM 1.2 `cmi.core.lesson_status` or 2004 `cmi.completion_status`/`success_status`/`score`) is normalized server-side. Manifest parsing fails closed against XXE/billion-laughs (entities off, `<!DOCTYPE`/`<!ENTITY` rejected, 1 MB cap) and rejects unsafe (absolute/traversal/backslash) launch hrefs. Completion is surfaced to the gradebook by emitting a `learning.event_captured` outbox row (source:"scorm", with the `passed` flag) in the SAME transaction as the attempt upsert; the analytics/LRS path consumes it today. Documented follow-ups: server-side unzip + byte-serving of the SCORM runtime assets (parser takes manifest XML only; launch href is rendered, not yet served), the full SCORM JS RTE bridge (`window.API` / `API_1484_11`), a dedicated `scorm.attempt_recorded` event verb + a grading-side consumer that writes a `grade` (needs `'scorm'` in `GradeItemSource`), and a service-side authenticated-user header so `learnerId` is resolved at the service rather than trusted from the BFF-supplied body. xAPI ingestion, draft/published state, virus scanning, per-plan size limits, and page-version retention/restore remain tracked follow-ups.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
