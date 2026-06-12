# assignment service

- **Port (dev):** 4007
- **Data shape:** Postgres + Blob
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Assignments, submissions, late/penalty policy, plagiarism integration hooks, file handling.

## Owned tables

`assignment`, `submission`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/assignments` | Create assignment with due/late policy. |
| `POST` | `/assignments/{id}/submissions` | Submit (file -> Blob, emits submission.created). |
| `GET` | `/assignments/{id}/submissions` | List submissions for grading. |

## Events published

- `assignment.created`
- `submission.created`
- `submission.late`

## Events consumed

- `grading.graded (reflect status)`
- `plagiarism.report.ready`

## Dependencies

- Vercel Blob (uploads)
- grading (gradebook line item)
- rubric (attached rubric)

## Notes

Submissions stored in Blob; metadata in Postgres. Plagiarism is an async hook.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
