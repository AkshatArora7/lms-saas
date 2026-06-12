# notification service

- **Port (dev):** 4012
- **Data shape:** Postgres + Redis
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Multi-channel delivery (email/SMS/push/in-app), per-user preferences, unread counters, intelligent-agent automation.

## Owned tables

`notification`, `notification_preference`, `intelligent_agent`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/users/{id}/notifications` | In-app inbox + unread count. |
| `PUT` | `/users/{id}/preferences` | Update channel preferences. |
| `POST` | `/agents` | Define an intelligent agent (condition -> action). |

## Events published

- `notification.sent`
- `notification.failed`

## Events consumed

- `announcement.published`
- `discussion.post.created`
- `grading.graded`
- `assignment.created`
- `enrollment.created`

## Dependencies

- Email/SMS/Push providers
- Upstash Redis (unread counters)
- analytics (agent triggers)

## Notes

Central fanout consumer; respects per-user preferences and quiet hours. Intelligent agents evaluate analytics signals.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
