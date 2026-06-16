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
| `POST` | `/rubrics` | Author a rubric (criteria x levels; analytic/holistic). |
| `GET` | `/rubrics` | List rubrics (filter by courseId). |
| `GET` | `/rubrics/{id}` | Fetch a rubric with its full grid. |
| `POST` | `/rubrics/{id}/criteria` | Append a criterion (+ levels). |
| `POST` | `/rubrics/{id}/score` | Tally picked levels -> total/max (maps to a grade item). |
| `DELETE` | `/rubrics/{id}` | Delete a rubric. |
| `POST` | `/competencies` | Define a competency/outcome (hierarchical). |
| `GET` | `/competencies` | List competencies. |
| `POST` | `/objectives` | Define a learning objective. |
| `POST` | `/objectives/{id}/alignments` | Align an objective to an activity. |
| `GET` | `/activities/{targetType}/{targetId}/objectives` | Objectives aligned to an activity. |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- grading (consumes rubric scores)
- analytics (mastery signals)

## Notes

Rubric scoring is a pure tally the grading service maps onto a line item. Per-learner mastery roll-up (needs grade data) and rubric<->activity attachment (needs a join table) are tracked follow-ups.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
