# assignment service

- **Port (dev):** 4007
- **Data shape:** Postgres + Blob
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Assignments, submissions, late/penalty policy, plagiarism integration hooks, file handling.

## Owned tables

`assignment`, `submission`, `submission_annotation`, `assignment_group`, `assignment_group_member`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/assignments` | Create assignment with due/late policy. |
| `POST` | `/assignments/{id}/submissions` | Submit (file -> Blob, emits submission.created). |
| `GET` | `/assignments/{id}/submissions` | List submissions for grading. |
| `POST` | `/submissions/{id}/annotations` | Add inline feedback (anchored comment). |
| `GET` | `/submissions/{id}/annotations` | List annotations (released=true for the learner view). |
| `POST` | `/submissions/{id}/feedback/release` | Release feedback -> learner notified (submission.feedback_released). |
| `POST` | `/assignments/{id}/groups` | Create a group; manage membership (one group per learner). |
| `GET` | `/assignments/{id}/groups/for-user/{userId}` | Resolve a learner's group for group submission. |

## Events published

- `assignment.created`
- `submission.created`
- `submission.late`
- `submission.feedback_released`

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
