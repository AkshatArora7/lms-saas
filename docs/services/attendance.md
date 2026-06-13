# attendance service

- **Port (dev):** 4025
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Class attendance and participation: per-tenant attendance codes, attendance sessions (one per section meeting), per-student records, and summaries/exports for compliance and SIS.

## Owned tables

`attendance_code`, `attendance_session`, `attendance_record`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/codes` | Define/seed per-tenant attendance codes and categories. |
| `POST` | `/sessions` | Open an attendance session for a section meeting (roster from enrollment/timetable). |
| `PUT` | `/sessions/{id}/records` | Mark each student present/absent/tardy/excused; edit until finalized. |
| `POST` | `/sessions/{id}/finalize` | Finalize a session (locks records). |
| `GET` | `/sections/{id}/attendance/summary` | Attendance rates and chronic-absence flags. |
| `GET` | `/users/{id}/attendance` | A student's attendance history. |

## Events published

- `attendance.marked`
- `attendance.session.finalized`

## Events consumed

- `enrollment.created`
- `timetable.entry.scheduled`

## Dependencies

- enrollment (roster)
- calendar (timetable)
- notification (absence alerts)
- reporting (exports)

## Notes

Attendance codes are tenant-owned (per-tenant policy); records are RLS-isolated. Marking emits events for notifications and analytics.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
