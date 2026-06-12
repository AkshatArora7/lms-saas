# grading service

- **Port (dev):** 4009
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Gradebook: categories, line items, grade schemes, calculated and final grades (OneRoster results + LTI AGS).

## Owned tables

`grade_scheme`, `grade_category`, `grade_item`, `grade`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/courses/{id}/gradebook` | Full gradebook matrix. |
| `PUT` | `/grade-items/{id}/grades/{userId}` | Enter/override a grade. |
| `POST` | `/courses/{id}/final-grades/calculate` | Recalculate final grades. |
| `GET` | `/lti/ags/lineitems` | AGS line items for LTI tools. |

## Events published

- `grading.graded`
- `grading.final.calculated`

## Events consumed

- `submission.created`
- `quiz.graded`
- `assignment.created (create line item)`

## Dependencies

- assessment
- assignment
- lti (AGS exposure)
- sis (results export)

## Notes

Source of truth for grades; exposes LTI AGS and OneRoster results.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
