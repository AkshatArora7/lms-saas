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
| `GET` | `/mobile/home` | Home screen: enrolled courses + due-soon + unread badge in one round-trip. |
| `GET` | `/mobile/courses/{courseId}` | Course detail screen: course + its assignments. |
| `GET` | `/mobile/notifications` | Notifications screen with computed unread count. |
| `POST` | `/mobile/assignments/{assignmentId}/submissions` | Submit work from mobile (forwards to the assignment service). |
| `POST` | `/mobile/devices` | Register a device push token for notifications. |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- gateway (auth + proxy)
- course
- calendar
- notification
- assignment
- enrollment
- identity

## Notes

Stateless aggregation behind the same bearer-token model; verifies the token, fans out per screen via the gateway, and registers devices (push delivery is owned by the notification service).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
