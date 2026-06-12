# course service

- **Port (dev):** 4005
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Courses, course templates, sections, terms, and course copy/import.

## Owned tables

`course`, `release_condition`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/courses` | Create a course (optionally from template). |
| `POST` | `/courses/{id}/copy` | Deep-copy course content into a new offering. |
| `GET` | `/courses/{id}` | Course with sections and release conditions. |
| `POST` | `/courses/{id}/release-conditions` | Define gated-release rules. |

## Events published

- `course.created`
- `course.published`
- `course.copied`

## Events consumed

- `sis.class.upserted`
- `term.created`

## Dependencies

- content (module tree)
- user-org (org placement)

## Notes

Release conditions are evaluated by content/assessment at access time.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
