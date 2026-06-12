# enrollment service

- **Port (dev):** 4004
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Enrollments and section roles with full lifecycle (active/completed/dropped) per OneRoster enrollments; drives the enroll+billing saga.

## Owned tables

`enrollment`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/enrollments` | Enroll a user in a section with a role (starts saga). |
| `DELETE` | `/enrollments/{id}` | Drop/withdraw (lifecycle transition). |
| `GET` | `/sections/{id}/roster` | Active roster for a section. |

## Events published

- `enrollment.created`
- `enrollment.dropped`
- `enrollment.completed`

## Events consumed

- `sis.enrollment.upserted`
- `billing.seat.reserved`
- `billing.seat.rejected`

## Dependencies

- course (section validity)
- billing (seat reservation)
- user-org (user validity)

## Notes

Owns the enroll->reserve-seat->confirm saga; compensates by withdrawing on seat rejection.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
