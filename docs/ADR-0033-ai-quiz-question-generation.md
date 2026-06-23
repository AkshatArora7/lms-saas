# ADR-0033 — AI quiz-question draft generation: `ai` owns the LLM seam, transient drafts, client maps to the assessment bank

- **Status:** Accepted · 2026-06-22
- **Issue:** #65 — AI quiz-question draft generation (epic #63)
- **Owning scope:** `services/ai` (bounded context) — docs
- **Author:** Architect agent (recorded by docs-agent)

## Context

Issue #65 asks the platform to **draft quiz questions with an LLM for a teacher
to review, edit, and publish** into the existing question bank. Two bounded
contexts already exist and own the relevant pieces:

- **`ai`** owns the LLM seam. The `ChatModel` interface +
  `FakeChatModel`/`groqChatModel`/`makeChatModel` (`services/ai/src/chat.ts`)
  are injectable into every route via `buildApp({ ...chat })`
  (`services/ai/src/main.ts`), and Groq config (`GROQ_API_KEY`/`GROQ_MODEL`)
  already lives in `packages/config`. This is the same seam established for the
  RAG study assistant in [ADR-0028](ADR-0028-ai-rag-study-assistant.md).
- **`assessment`** owns the question bank ("question library"). A question is
  persisted via `addQuestion(ctx, libraryId, NewQuestionInput)` behind the
  existing `POST /question-libraries/:id/questions`
  (`services/assessment/src/routes.ts`), where
  `NewQuestionInput = { kind, stem, points?, body?, difficulty? }`
  (`services/assessment/src/store.ts`).

The same two constraints that shaped ADR-0028 apply: tests and CI must run
**offline with no API key or network**, and the design must not couple the two
services more than the acceptance criteria require. The acceptance criteria are
human-in-the-loop: generate drafts for review (AC1), map an approved draft to
the question bank (AC2), and keep drafts editable before publish (AC3).

## Decision

### 1. Service ownership: `ai` generates; the client/BFF maps to `assessment`

**Generation lives in `ai`** because it already owns the `ChatModel`/Groq seam —
duplicating that seam into `assessment` would split LLM ownership across two
bounded contexts for no AC benefit. **Persistence stays in `assessment`**, which
owns the question bank as the single system of record.

The flow is the least-coupling one that satisfies every AC:

1. `ai` generates and **returns drafts transiently** (no persistence).
2. The teacher reviews/edits the drafts client-side.
3. The **client/BFF POSTs each approved draft verbatim** to the *existing*
   assessment endpoint `POST /question-libraries/:id/questions`.

There is **no new cross-service contract**: the `ai` service makes **no
server-side call to `assessment`**, needs no `SERVICE_URL_ASSESSMENT` plumbing,
and adds no second tenant-header hop. This is strictly less coupling than an
`ai → assessment` server call and mirrors ADR-0028's rejection of unnecessary
service-to-service coupling.

### 2. Drafts are TRANSIENT — no table, no RLS, no events

AC1 ("generate for review") and AC3 ("editable before publish") are satisfied
**without server-side draft state**: the endpoint returns plain JSON draft
objects; the teacher edits them client-side; persistence happens **only at
map-to-bank** via the existing `addQuestion`. Consequently there is **no new
table, no RLS work** (Data & RLS = n/a), and discarded drafts never pollute the
bank. "Editable" lives entirely between the generation response and the
map-to-bank POST — there is no server-side draft record to mutate. The slice
publishes/consumes **no domain events**: generation is a read-only LLM call, and
`addQuestion` itself emits none.

### 3. v1 endpoint + contract (in `ai`)

**`POST /courses/:courseId/question-drafts`** — generate draft questions
(returns `200`, persists nothing — not `201`, because nothing is created
server-side). Registered in `registerAiRoutes` alongside `reindex`/`chat`,
reusing the existing injected `chat` dep (no new `AiRouteDeps`).

- **Headers:** `x-tenant-id` required → `400 tenant_required` (uniform with all
  `ai` routes via `resolveTenantOr400`); `x-user-id` required →
  `400 user_required` ([ADR-0027](ADR-0027-trusted-identity-headers.md) parity —
  audit only, no persistence). Because v1 supplies its own grounding text, the
  route does **no tenant-scoped DB read** and is fully stateless.
- **Request body (zod):**
  ```ts
  {
    count?: number,                 // int 1..20, default 5
    kinds?: ("multiple_choice" | "true_false" | "short_answer")[],  // default all three
    difficulty?: "easy" | "medium" | "hard",   // default "medium"
    topic?: string,                 // refine: at least one of topic | sourceText (non-empty) required
    sourceText?: string             // reading/passage to ground on (<= ~8k chars)
  }
  ```
  Invalid input → `400 invalid_request`.
- **Response `200`:** `{ drafts: Array<{ kind, stem, points?, body, difficulty }> }`.
  Each draft is **1:1 with assessment's `NewQuestionInput`**, so the client POSTs
  it verbatim — no field remapping. Zero usable drafts → `502 generation_failed`.
- **v1 kinds** (a small, gradeable set) and their answer-key `body` shapes match
  assessment's stored `body` exactly:
  - `multiple_choice` → `{ options: [{ id, label }], correct: id }`
  - `true_false` → `{ correct: boolean }`
  - `short_answer` → `{ answers: string[], caseSensitive?: boolean }`

### 4. Prompt contract + deterministic, offline-testable parse

Two **pure** helpers in `services/ai/src/chat.ts` (mirroring
`buildGroundedMessages`):

- `buildQuestionGenMessages(params): ChatMessage[]` — a system instruction that
  pins the role ("assessment item writer"), the requested kinds/count/difficulty,
  the strict per-kind JSON shape, and "output a STRICT JSON array and nothing
  else"; plus the user's `topic`/`sourceText`.
- `parseQuestionDrafts(raw, params): QuestionDraft[]` — strip optional
  ` ```json ` fences, `JSON.parse`, **zod-validate each element per kind, drop
  invalid items**, stamp the `points`/`difficulty` defaults, and clamp to
  `count`. It is **total and deterministic**: it never throws to the caller and
  returns `[]` if the output is unparseable.

The **`FakeChatModel` stays the offline default** (key-free, per ADR-0028):
`complete()` branches on a generation sentinel in the system prompt and returns a
**deterministic JSON array** derived from `(topic|sourceText, count, kinds,
difficulty)` (round-robin over `kinds`, templated stems), otherwise falls back to
the existing grounded-chat answer. This keeps the whole service offline-by-default
end-to-end and lets the test suite assert the exact drafts array by injecting the
same fake via `buildApp({ chat })` — no network, no key.

## Consequences

- **No schema, no RLS, no events, no new config.** The slice adds no table and
  touches neither `database/schema.sql` nor `database/policies/rls.sql`; it reuses
  the existing `GROQ_API_KEY`/`GROQ_MODEL` and the offline `FakeChatModel`
  default. `assessment` is unchanged — its existing
  `POST /question-libraries/:id/questions` is the sink.
- **The service stays key-free and offline by construction.** The full unit suite
  passes with no `GROQ_API_KEY` and no network because both the generation and
  the parse paths are deterministic and pure.
- **Model output cannot inject fields or structure.** Drafts are reconstructed
  field-by-field from a per-kind zod schema with invalid items dropped, so a
  malformed or adversarial completion degrades to fewer/no drafts rather than a
  malformed question reaching the bank.
- **The client/BFF owns orchestration.** Because `ai` returns transient drafts
  and the client maps approved ones to `assessment`, there is no second source of
  truth and no `ai → assessment` coupling; the trade-off is that the
  generate-review-publish flow is assembled on the client rather than in a single
  server call.

## Future work (non-blocking follow-ups)

- **Teacher review/edit UI** (`apps/web`) consuming
  `POST /api/ai/courses/:id/question-drafts` and posting approved drafts to the
  assessment bank — **must HTML-escape** LLM-authored stems/options when rendering
  (untrusted model output).
- **Optional server-side "draft inbox"** that survives reloads (a persisted draft
  table + RLS) — only if a future story needs drafts to outlive the client session.
- **Retrieval-grounded generation** — ground drafts in the course's
  `ai_embedding` chunks (reuse the ADR-0028 RAG retrieval) instead of
  caller-supplied `topic`/`sourceText`.
- **Per-tenant LLM rate limiting** on the generation endpoint (cost control),
  beyond the gateway's generic limiter — mirrors the ADR-0028 follow-up for chat.

## Alternatives considered

- **(A) A generation endpoint *inside* `assessment` with an injected `ChatModel`**
  — rejected: it duplicates the Groq seam/config out of `ai` (its bounded context)
  into `assessment`, splitting LLM ownership across two services for no AC benefit.
- **(B) An `ai → assessment` server-side call** (ai generates *and* writes the
  questions) — rejected: more coupling (`SERVICE_URL_ASSESSMENT`, a second
  tenant-header hop) and it removes the human-in-the-loop review the ACs require.
- **(C) A persisted draft table with RLS** — rejected for v1: it adds schema/RLS
  state and a second system of record for no AC benefit, since the question bank
  is already the system of record and review happens client-side. Kept as a
  future enhancement (server-side draft inbox) if a story ever needs it.
