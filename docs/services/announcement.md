# announcement service

- **Port (dev):** 4011
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Course/org announcements with scheduled publish and notification fanout.

## Owned tables

`announcement`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/announcements` | Create/schedule an announcement. |
| `GET` | `/courses/{id}/announcements` | List visible announcements. |

## Events published

- `announcement.published`

## Events consumed

_None_

## Dependencies

- notification (fanout)
- calendar (optional event)

## Notes

Scheduled publishing via QStash schedule; fanout handled by notification.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
