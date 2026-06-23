# ai service

- **Port (dev):** 4017
- **Data shape:** pgvector + JSONB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

AI study assistant: embeds a course's content into pgvector and answers student questions via Groq RAG with citations, grounded ONLY in retrieved chunks; also drafts quiz questions for teacher review. Tenant-isolated by Postgres RLS.

## Owned tables

`ai_embedding`, `ai_chat`, `ai_message`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/courses/{courseId}/reindex` | (Re)build the course's embedding index -- idempotent delete-then-insert over content_topic.body chunks. |
| `POST` | `/courses/{courseId}/chat` | Ask a question: embed -> top-k (k=5) cosine retrieval (RLS-scoped) -> Groq grounded answer with citations; persists the chat + user/assistant messages. Retrieved context + question are wrapped in labeled untrusted-data delimiters and the system prompt refuses embedded instructions (prompt-injection hardening); over-long messages are rejected 400 invalid_request before any model call. Requires x-user-id. |
| `POST` | `/courses/{courseId}/question-drafts` | Generate transient quiz-question drafts (multiple_choice/true_false/short_answer) for teacher review -- LLM-authored, zod-validated per kind, each 1:1 with assessment's NewQuestionInput; nothing persisted, no events. Requires x-user-id. |
| `GET` | `/courses/{courseId}/chats` | List the caller's chats for a course (x-user-id owned). |
| `GET` | `/chats/{chatId}/messages` | List messages for one of the caller's chats (ownership-checked). |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- Groq (LLM, GROQ_API_KEY, optional; GROQ_MAX_TOKENS caps /chat output, default 1024)
- pgvector
- content (content_topic.body, direct RLS-scoped read)

## Notes

Retrieval grounded in tenant-scoped embeddings; never crosses tenant boundary (FORCE RLS on ai_embedding/ai_chat/ai_message; every store method runs inside withTenant). Embeddings come from an injectable Embedder (default: deterministic 1024-dim HashingEmbedder -- Groq serves no embeddings API); the chat answer from an injectable ChatModel (Groq when GROQ_API_KEY is set, else a deterministic offline fake) so the service boots and tests run key-free/offline. Reads content_topic.body directly via @lms/db withTenant rather than calling the content service. Caller identity via x-user-id (ADR-0027). Quiz-question draft generation (POST /courses/{courseId}/question-drafts) reuses the same injectable ChatModel seam: pure buildQuestionGenMessages + total parseQuestionDrafts (per-kind zod validation, drop-invalid, clamp to count) return drafts that are 1:1 with assessment's NewQuestionInput, so the client/BFF maps approved drafts to assessment's existing POST /question-libraries/{id}/questions -- the ai service makes NO server-side call to assessment, holds NO draft state (transient, no table/RLS), and emits no events. HTTP request/response only -- no outbox/inbox events wired yet. /chat is hardened against prompt injection: the system instruction treats retrieved COURSE CONTEXT + the STUDENT QUESTION as untrusted DATA wrapped in labeled fenced delimiters and refuses any embedded directives; the user message is length-capped (over-long -> 400 invalid_request with no downstream model/embedder call), each retrieved chunk is truncated when rendered to bound prompt size, and the Groq completion is bounded by a max output-token cap (GROQ_MAX_TOKENS, default 1024). RLS remains the data-isolation guarantee; the prompt hardening is best-effort cost/robustness defense-in-depth. See [ADR-0028](../ADR-0028-ai-rag-study-assistant.md) and [ADR-0033](../ADR-0033-ai-quiz-question-generation.md).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
