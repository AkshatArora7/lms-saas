# ai service

- **Port (dev):** 4017
- **Data shape:** pgvector + JSONB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

AI study assistant: embeds a course's content into pgvector and answers student questions via Groq RAG with citations, grounded ONLY in retrieved chunks. Tenant-isolated by Postgres RLS.

## Owned tables

`ai_embedding`, `ai_chat`, `ai_message`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/courses/{courseId}/reindex` | (Re)build the course's embedding index -- idempotent delete-then-insert over content_topic.body chunks. |
| `POST` | `/courses/{courseId}/chat` | Ask a question: embed -> top-k (k=5) cosine retrieval (RLS-scoped) -> Groq grounded answer with citations; persists the chat + user/assistant messages. Requires x-user-id. |
| `GET` | `/courses/{courseId}/chats` | List the caller's chats for a course (x-user-id owned). |
| `GET` | `/chats/{chatId}/messages` | List messages for one of the caller's chats (ownership-checked). |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- Groq (LLM, GROQ_API_KEY, optional)
- pgvector
- content (content_topic.body, direct RLS-scoped read)

## Notes

Retrieval grounded in tenant-scoped embeddings; never crosses tenant boundary (FORCE RLS on ai_embedding/ai_chat/ai_message; every store method runs inside withTenant). Embeddings come from an injectable Embedder (default: deterministic 1024-dim HashingEmbedder -- Groq serves no embeddings API); the chat answer from an injectable ChatModel (Groq when GROQ_API_KEY is set, else a deterministic offline fake) so the service boots and tests run key-free/offline. Reads content_topic.body directly via @lms/db withTenant rather than calling the content service. Caller identity via x-user-id (ADR-0027). HTTP request/response only -- no outbox/inbox events wired yet. See [ADR-0028](../ADR-0028-ai-rag-study-assistant.md).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
