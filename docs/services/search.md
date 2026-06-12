# search service

- **Port (dev):** 4021
- **Data shape:** Postgres (FTS/vector)
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Full-text and vector search across content/courses/discussions, per-tenant filtered indexes.

## Owned tables

_None_ (stateless or operates on derived/index data only).

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/search` | Unified query (FTS + vector), tenant-filtered. |
| `POST` | `/index/reindex` | Rebuild index for an entity type. |

## Events published

- `search.reindexed`

## Events consumed

- `content.created`
- `course.created`
- `discussion.post.created`
- `content.completed`

## Dependencies

- Postgres FTS + pgvector
- content
- course
- discussion

## Notes

Owns index tables only (derived); every query is constrained by app.tenant_id.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
