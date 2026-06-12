# ai service

- **Port (dev):** 4017
- **Data shape:** pgvector + JSONB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Lumi-equivalent assistant: content generation, feedback, Q&A via RAG over course content (pgvector + Groq).

## Owned tables

`ai_embedding`, `ai_chat`, `ai_message`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/embeddings/reindex` | (Re)embed content for a course. |
| `POST` | `/chats` | Start a grounded chat session. |
| `POST` | `/chats/{id}/messages` | Ask a question (RAG answer with citations). |

## Events published

- `ai.answer.generated`

## Events consumed

- `content.completed (reindex)`
- `content.viewed`

## Dependencies

- Groq (LLM, GROQ_API_KEY)
- pgvector
- content (source docs)

## Notes

Retrieval grounded in tenant-scoped embeddings; never crosses tenant boundary (RLS on ai_embedding).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
