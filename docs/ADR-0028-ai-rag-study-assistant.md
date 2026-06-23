# ADR-0028 — AI study assistant: RAG contract + injectable embedder/chat model

- **Status:** Accepted · 2026-06-21
- **Issue:** #64 — AI study assistant grounded in course content (epic #63)
- **Owning scope:** `services/ai` (bounded context), `packages/config` (Groq config) — docs
- **Author:** Architect agent (recorded by docs-agent)

## Context

The `ai` service was a health-only stub (`GET /health` + a `// TODO: register
domain routes`). Issue #64 asks it to become a real bounded context: a study
assistant that embeds a course's content into pgvector and answers student
questions with **Retrieval-Augmented Generation (RAG)** grounded only in that
course's material, with citations, **tenant-isolated** so no answer can ever be
grounded in another tenant's content.

The schema already provided the data model (`database/schema.sql`, pgvector
`CREATE EXTENSION "vector"`): `ai_embedding(id, tenant_id, course_id,
source_type, source_id, chunk, embedding vector(1024), created_at)`,
`ai_chat(id, tenant_id, user_id, course_id, feature, created_at)`, and
`ai_message(id, tenant_id, chat_id, role, content, citations jsonb DEFAULT '[]',
created_at)`. RLS for all three tables is already wired
(`database/policies/rls.sql`): they sit in the `tenant_tables` loop that runs
`ENABLE` + `FORCE ROW LEVEL SECURITY` and creates the `tenant_isolation` policy
`USING/WITH CHECK (tenant_id = current_tenant_id())` — so **no schema change was
required** for the tenant-isolation acceptance criterion.

Two real constraints shaped the design:

1. **Groq serves no embeddings API** — it is a chat-completion provider only.
   So the embedding vectors cannot come from the same place as the chat answer;
   an embedding source must be chosen separately and must produce `vector(1024)`
   to match the column.
2. **Tests and CI must run offline with no API key or network.** The repo's
   verification gates (`qa-agent`) run key-free; a service that hard-depends on a
   live Groq key (or any hosted provider) at import or boot time would break
   them.

The groundable content lives in the **content** service's tables
(`content_topic.body` joined to `content_module` by `course_id`), which the ai
service does not own.

## Decision

### 1. RAG contract (pgvector cosine retrieval, RLS-scoped)

The service exposes two write paths and two read paths behind the gateway as
`/api/ai/*` (port 4017). Tenant comes from the gateway's trusted `x-tenant-id`
(`headerTenantResolver` → 400 `tenant_required` if absent); caller identity from
the trusted `x-user-id` (see [ADR-0027](ADR-0027-trusted-identity-headers.md))
→ 400 `user_required` if absent.

- **`POST /courses/:courseId/reindex`** — (re)build the embedding index for a
  course. **Idempotent delete-then-insert**: read the course's topics (join
  `content_topic` → `content_module` by `course_id`), chunk each `body` on
  whitespace (~1000 chars, overridable via `{ chunkSize }`), embed the chunks,
  and replace all `ai_embedding` rows for `(course_id, source_type='content_topic')`.
  Returns `{ courseId, topics, chunks, embedded }`. A course with no text →
  `{ topics: 0, chunks: 0, embedded: 0 }` and any stale embeddings are cleared.
- **`POST /courses/:courseId/chat`** `{ message, chatId? }` — embed the question,
  run **top-k (k=5) cosine retrieval** over the course's embeddings, build a
  grounded prompt (a fixed system instruction: *answer using ONLY the provided
  course context; if it isn't there, say you don't have enough material* + the
  numbered retrieved chunks), call the chat model, and persist a `user` message
  and an `assistant` message. Returns `{ chatId, answer, citations[] }`.
  Citations have the shape `{ sourceType, sourceId, chunk, score }` and are
  persisted in `ai_message.citations` (jsonb). Empty retrieval still answers
  (the model is instructed to say it lacks context) with `citations: []`.
- **`GET /courses/:courseId/chats`** and **`GET /chats/:chatId/messages`** —
  caller-owned history reads (ownership checked against `x-user-id` → 404 if the
  chat is not the caller's).

Retrieval SQL runs inside `withTenant(ctx, ...)`; RLS supplies the tenant and the
query only filters `course_id`:

```sql
SELECT source_type, source_id, chunk,
       1 - (embedding <=> $2::vector) AS score
  FROM ai_embedding
 WHERE course_id = $1::uuid
   AND embedding IS NOT NULL
 ORDER BY embedding <=> $2::vector
 LIMIT $3
```

`<=>` is pgvector **cosine distance** (matching `vector_cosine_ops`); `score =
1 - distance`. There is **no `tenant_id` predicate** — RLS enforces it.

### 2. Injectable `Embedder` and `ChatModel` (offline-testable by construction)

The two external-AI seams are interfaces so the service is key-free and offline
by default, and a hosted provider can drop in later behind env with no caller
changes:

```ts
// embedder.ts
export interface Embedder { embed(texts: string[]): Promise<number[][]>; } // each vector length === EMBED_DIM (1024)
// chat.ts
export interface ChatModel { complete(messages: ChatMessage[]): Promise<string>; }
```

- **Default `Embedder` = a deterministic `HashingEmbedder`** — FNV-1a hashes each
  lowercased word token into one of 1024 buckets (bag-of-words), then
  L2-normalizes so cosine similarity is meaningful. No network, no key, fully
  reproducible. It is its own production default **because Groq has no embeddings
  API**, so the embedding source is necessarily separate from the chat model; a
  self-contained deterministic embedder keeps the whole service key-free and the
  `Embedder` interface lets a real 1024-dim provider (e.g. Cohere
  `embed-english-v3.0`, or transformers.js `bge-large-en-v1.5`) drop in later.
- **Default `ChatModel` = Groq when `GROQ_API_KEY` is set, else a deterministic
  `FakeChatModel`.** `groqChatModel` **lazy-imports** `groq-sdk` only inside
  `complete()`, so importing the module never needs a key or touches the network;
  `makeChatModel(config)` returns the fake when no key is configured. Tests inject
  their own fake explicitly.

This is the core reason `@lms/service-ai` tests run **fully offline** (15/15,
no `GROQ_API_KEY`, no network): they wire `MemoryAiStore` + `HashingEmbedder` +
`FakeChatModel`.

### 3. Read content via a direct, RLS-scoped DB query (not service-to-service)

The ai service owns `ai_embedding`, `ai_chat`, `ai_message`. To build the index
it must read `content_topic.body`, which **content** owns. The decision is to
read it via a **direct RLS-scoped DB query** (`@lms/db.withTenant` joining
`content_topic` → `content_module` by `course_id`) rather than calling the
content service over HTTP.

Rationale: a batch reindex needs *all* topics for a course; content exposes no
"topics-by-course" endpoint (it would be a 2-hop modules→topics traversal), and a
read inside `withTenant` is already tenant-isolated by the same RLS guarantee —
simpler, lower-latency, and no double tenant-header plumbing. The trade-off (ai
reads a table it does not own) is acceptable and precedented for read-only
grounding; if content later moves to a silo DB the ai service cannot reach, the
same `AiStore.readCourseTopics` method can switch to the HTTP path with no
caller change.

### 4. Tenant isolation (ADR-0026) + caller identity (ADR-0027)

Tenant isolation is the sacred boundary and is unchanged from the platform
model. The runtime connects as `app_user` (`NOBYPASSRLS`, see
[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)); the three AI tables
have `FORCE ROW LEVEL SECURITY` + the `tenant_isolation` policy; and **every**
`AiStore` method — reindex insert, retrieval select, chat/message writes, history
reads — runs inside `withTenant(ctx, ...)`, which sets `app.tenant_id`. No
`tenant_id` is ever accepted from the client. Caller identity for chat ownership
comes from the gateway-stamped trusted `x-user-id`
([ADR-0027](ADR-0027-trusted-identity-headers.md)).

## Consequences

- **The service is key-free and offline by default.** It boots and its full unit
  suite passes with no `GROQ_API_KEY` and no network, because both AI seams have
  deterministic offline implementations. Adding a real hosted embedder or a live
  Groq key is purely additive (env + a constructor swap behind the existing
  interface).
- **Cross-tenant grounding is impossible by construction.** Retrieval can only
  see the current tenant's embeddings (FORCE RLS + `withTenant`), proven by a
  two-tenant test: tenant A reindexes a course, tenant B chats the same course
  and gets `citations: []`.
- **The ai service depends on content at the data layer**, not the service layer.
  This couples ai to `content_topic`'s shape for read-only grounding; revisit if
  content is siloed away from ai's DB reach.
- **HashingEmbedder has weaker semantic recall** than a transformer embedding —
  acceptable for this story's demo scope and swappable behind `Embedder`.
- **No domain events yet.** This slice is HTTP request/response only; the service
  publishes/consumes nothing on the outbox/inbox and is not wired into `relay`.
  Reindex is a manual call, not driven by `content.*` events.

## Future work (non-blocking follow-ups)

- **Prompt-injection hardening / `max_tokens`** on the Groq completion call.
- ~~**Per-tenant rate limiting** on the chat endpoint (LLM cost control), beyond
  the gateway's generic limiter.~~ **Done (#309):** `/chat` now enforces a
  per-user then per-tenant fixed-window rate limit via the shared
  `@lms/ratelimit` package (in-process `MemoryRateLimiter` fallback,
  Upstash-optional) returning **429 `rate_limited`**, plus a durable per-tenant
  per-UTC-day usage ceiling tracked in the tenant-scoped, RLS-isolated `ai_usage`
  table (request count + worst-case token estimate) returning **429
  `cost_exceeded`** *before* any embed/retrieval/Groq call. Configurable via
  `packages/config`: `AI_CHAT_USER_RATE_LIMIT_MAX` (30),
  `AI_CHAT_RATE_LIMIT_MAX` (120), `AI_CHAT_RATE_LIMIT_WINDOW_SECONDS` (60),
  `AI_CHAT_DAILY_TENANT_REQUEST_CEILING` (2000), and
  `AI_CHAT_DAILY_TENANT_TOKEN_CEILING` (0 = token ceiling disabled).
- **`ivfflat` index** on `ai_embedding.embedding` (`vector_cosine_ops`, mirroring
  `search_document`) — retrieval is a seq scan today; correct but unindexed at
  demo scale.
- **A live pgvector RLS integration test** against compose Postgres (the offline
  suite proves isolation via the memory store; a DB-backed test would exercise
  the real `<=>` retrieval under RLS).
- **Student AI tutor chat UI** (`apps/web`) consuming `/api/ai/courses/:id/chat`
  + `/api/ai/courses/:id/chats` — deferred to a follow-up story (backend-first).

## Alternatives considered

- **(A) Service-to-service read of content over HTTP** (forward `x-tenant-id` to
  `SERVICE_URL_CONTENT`) — rejected for the batch reindex: more coupling and
  latency, N HTTP calls and double tenant-header plumbing, for a read the DB
  already isolates. Kept as a fallback behind the same store method if content is
  siloed.
- **(B) A mandatory hosted embedding provider as the default** (e.g. OpenAI
  `text-embedding-3-small`) — rejected: it would break key-free/offline qa, and
  `text-embedding-3-small` is 1536-dim ≠ the `vector(1024)` column. transformers.js
  `bge-large-en-v1.5` (1024-dim) was rejected *as the default* because it pulls a
  heavy model download in CI — but it is a valid drop-in behind `Embedder`.
- **(C) Hard-depend on Groq at import/boot** — rejected: it would make the module
  un-importable without a key and break offline tests. Lazy-importing `groq-sdk`
  inside `complete()` and falling back to `FakeChatModel` keeps the service
  bootable and testable key-free.
