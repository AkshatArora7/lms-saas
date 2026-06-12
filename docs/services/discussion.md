# discussion service

- **Port (dev):** 4010
- **Data shape:** JSONB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Forums, topics/threads, posts and replies, subscriptions and read state.

## Owned tables

`discussion_forum`, `discussion_topic`, `discussion_post`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/forums` | Create a forum (course/org scoped). |
| `POST` | `/topics/{id}/posts` | Reply in a thread (emits discussion.post.created). |
| `POST` | `/topics/{id}/subscribe` | Subscribe for notifications. |

## Events published

- `discussion.post.created`
- `discussion.topic.created`

## Events consumed

- `course.created (default forum)`

## Dependencies

- notification (subscriber fanout)
- ai (moderation/summary, optional)

## Notes

Threaded posts in JSONB; notification fanout on new posts to subscribers.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
