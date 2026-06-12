# calendar service

- **Port (dev):** 4013
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Calendar events, deadlines, and iCal feed generation.

## Owned tables

`calendar_event`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/events` | Create an event/deadline. |
| `GET` | `/users/{id}/calendar.ics` | Personal iCal feed. |

## Events published

- `calendar.event.created`

## Events consumed

- `assignment.created`
- `quiz.attempt.started`
- `announcement.published`

## Dependencies

- notification (reminders)

## Notes

Aggregates deadlines from other contexts into a unified calendar/iCal feed.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
