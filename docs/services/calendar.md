# calendar service

- **Port (dev):** 4013
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Calendar events, deadlines, iCal feeds, and timetable/class scheduling (bell schedules, periods, section-period-room-teacher assignments).

## Owned tables

`calendar_event`, `bell_schedule`, `schedule_period`, `timetable_entry`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/calendar/events` | Create a manual event/deadline. |
| `PUT` | `/calendar/events/source` | Idempotently upsert an assignment/quiz due-date event (aggregation). |
| `GET` | `/calendar/events` | List events (filter by orgUnitId + from/to time range). |
| `GET` | `/calendar/feed.ics` | Timezone-correct (UTC) iCal subscription feed. |
| `POST` | `/schedules` | Create a bell schedule with named periods/times. |
| `POST` | `/timetable` | Assign a section to a period, room and instructor; detects conflicts. |
| `GET` | `/users/{id}/timetable` | Personal recurring weekly timetable. |

## Events published

- `timetable.entry.scheduled`

## Events consumed

- `assignment.created (due-date sync)`
- `quiz.attempt.started`

## Dependencies

- notification (reminders)
- user-org (sections/instructors)

## Notes

Aggregates deadlines and timetable meetings into a unified calendar/iCal feed. Room/teacher/period conflicts are validated on write.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
