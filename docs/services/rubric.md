# rubric service

- **Port (dev):** 4014
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Rubrics, competencies, learning objectives/outcomes, objective alignment and mastery (LTI Rubric Service).

## Owned tables

`rubric`, `rubric_criterion`, `rubric_level`, `competency`, `learning_objective`, `objective_alignment`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/rubrics` | Author a rubric (criteria x levels). |
| `POST` | `/competencies` | Define a competency/outcome. |
| `POST` | `/alignments` | Align an activity to objectives. |
| `GET` | `/users/{id}/mastery` | Mastery roll-up across aligned objectives. |

## Events published

- `rubric.scored`
- `mastery.updated`

## Events consumed

- `grading.graded (mastery recompute)`

## Dependencies

- grading (scores)
- analytics (mastery signals)

## Notes

Rubric scoring feeds both grading and competency mastery.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
