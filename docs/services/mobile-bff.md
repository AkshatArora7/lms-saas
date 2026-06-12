# mobile-bff service

- **Port (dev):** 4024
- **Data shape:** stateless
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Backend-for-frontend aggregating domain services for the React Native app (mobile-shaped payloads, fewer round-trips).

## Owned tables

_None_ (stateless or operates on derived/index data only).

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/home` | Aggregated dashboard (courses + deadlines + notifications). |
| `GET` | `/courses/{id}/overview` | Course bundle tuned for mobile. |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- course
- calendar
- notification
- grading
- identity

## Notes

Stateless aggregation; holds tokens server-side and keeps the mobile client thin.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
