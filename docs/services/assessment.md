# assessment service

- **Port (dev):** 4008
- **Data shape:** JSONB (write-heavy)
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Quizzes, question banks (QTI), sectioned exams, timed attempts, auto-grading.

## Owned tables

`question_library`, `question`, `quiz`, `quiz_section`, `quiz_question`, `quiz_attempt`, `quiz_response`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/quizzes` | Author a quiz from banks/sections. |
| `POST` | `/quizzes/{id}/attempts` | Start a timed attempt. |
| `POST` | `/attempts/{id}/submit` | Submit responses, auto-grade objective items. |
| `GET` | `/question-libraries/{id}/questions` | Browse/import bank items. |

## Events published

- `quiz.attempt.started`
- `quiz.attempt.submitted`
- `quiz.graded`

## Events consumed

- `course.copied (clone quizzes)`

## Dependencies

- grading (push scores)
- rubric (manual-grade rubrics)

## Notes

Write-heavy attempt path; JSONB for flexible item types. Objective grading is synchronous; subjective routes to grading.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
