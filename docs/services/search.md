# search service

- **Port (dev):** 4021
- **Data shape:** Postgres (pg_trgm/vector)
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Global tenant-scoped search read model across content/courses/people: keyword (pg_trgm) now, with a semantic (pgvector) embedding column present for a prod follow-up. Results are filtered by tenant and permission (allowed org units) and ranked.

## Owned tables

`search_document`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `PUT` | `/search/documents` | Upsert a tenant-scoped search document (idempotent on entity). |
| `DELETE` | `/search/documents/{entityType}/{entityId}` | Remove a document from the index. |
| `GET` | `/search` | Keyword (pg_trgm) search filtered by tenant + permission (allowed org units), ranked. |
| `GET` | `/search/typeahead` | Low-latency title typeahead (keyword, tenant + permission scoped). |

## Events published

_None_

## Events consumed

- `content.created`
- `course.created`
- `discussion.post.created`
- `content.completed`

## Dependencies

- Postgres pg_trgm + pgvector
- content
- course
- discussion

## Notes

Owns the denormalized `search_document` read model only (derived; one row per indexable entity, populated via events/backfill rather than by reading other services' tables). Keyword ranking is pg_trgm `similarity` today; the semantic (pgvector) embedding column is present but the `<=>` merge is a prod follow-up, so ranking degrades gracefully to keyword-only when no embedding is set. Every query is constrained by tenant (RLS on `app.tenant_id`) AND permission: a row is visible when `org_unit_id` is NULL (tenant-global, e.g. the people directory) or in the caller-supplied allowed org units. The allowed set can only narrow, never widen past the tenant boundary.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
