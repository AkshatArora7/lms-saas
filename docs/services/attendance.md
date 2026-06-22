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
| `POST` | `/sessions/{id}/finalize` | Finalize a session (locks records); emits attendance.flagged per absent/tardy. |
| `GET` | `/sections/{id}/attendance/summary` | Attendance rates and chronic-absence flags. |
| `GET` | `/users/{id}/attendance` | A student's attendance history. |

## Events published

- `attendance.marked`
- `attendance.session.finalized`
- `attendance.flagged`

## Events consumed

- `enrollment.created`
- `timetable.entry.scheduled`

## Dependencies

- enrollment (roster)
- calendar (timetable)
- notification (absence alerts)
- reporting (exports)
- user-org (consented-guardian resolution for absence/tardy fan-out, via GET /students/:studentId/guardians/authorized)

## Notes

Attendance codes are tenant-owned (per-tenant policy); records are RLS-isolated. Marking emits events for notifications and analytics. Guardian notification fan-out (#101): on `POST /sessions/:id/finalize`, each absent/tardy `attendance.flagged` outbox event now carries `recipientIds = [subject learner, ...consented guardians]` (order-preserving, deduped) instead of the learner only. The guardian ids are resolved through an injectable `StudentGuardiansResolver` port whose production HTTP adapter calls user-org `GET /students/:studentId/guardians/authorized` (forwarding `x-tenant-id`); attendance NEVER re-derives guardian relationships or consent — it consumes the already-filtered active+consented list. The port is DENY-BY-DEFAULT and FAIL-CLOSED: any non-2xx, network error, parse error, or unsatisfied consent yields `[]`, so the fan-out degrades to learner-only and never broadens or leaks across families/tenants. `payload.userId` stays the subject learner; the notification service is UNCHANGED and applies each recipient's own channel preferences. No schema change (recipientIds already lives in the `event_outbox` jsonb payload).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
