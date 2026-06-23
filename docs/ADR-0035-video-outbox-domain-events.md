# ADR-0035 — Video pipeline emits transactional outbox `video.ready` / `video.failed` events

- **Status:** Accepted · 2026-06-23
- **Issue:** #318 — feat(video): emit outbox video.ready / video.failed events
- **Owning scope:** `services/video` (bounded context) + `packages/events` (registry)
- **Author:** Architect agent

## Context

The async video pipeline advances `video_asset.status`
(`uploaded`→`transcoding`→`ready`|`failed`) but emits **no domain events**, so no
other service can react when a transcode finishes (`services/video/src/pipeline.ts`
`runPipeline`). Issue #318 asks the pipeline to emit `video.ready` / `video.failed`
outbox events (drained by the relay, `@lms/events`) so the notification service and a
future search-indexing consumer can react.

Grounded facts from source:

- The transactional outbox already exists: `event_outbox(id, tenant_id, type,
  actor_id, org_unit_id, payload jsonb, occurred_at, published_at)` with a partial
  index on unpublished rows (`database/schema.sql:883-894`). It is a tenant-scoped
  table in the RLS loop (`database/policies/rls.sql:30`), so writes are RLS-scoped to
  the connection's tenant.
- The relay drains rows and builds an `EventEnvelope` per row, **defaulting
  `version` to 1** (it is not a column) and passing `type` straight through with **no
  validation against the registry** (`services/relay/src/store.ts:82-93`,
  `services/relay/src/store.prisma.ts:48,102-105`). Adding new `EVENT_TYPES` is
  therefore purely additive — no relay/routing change is required.
- The notification consumer fans an event out to recipients **only when
  `payload.recipientIds` is present**, using `payload.title` as the message
  (`services/relay/src/consumer.ts:25-41`).
- Concrete precedent to mirror: `attendance.finalizeSession` flips status and writes
  the outbox row **in the same `withTenant` tx**, building the payload with a small
  `services/attendance/src/events.ts` builder that returns `{type, payload}` carrying
  `recipientIds` + `title` (`services/attendance/src/store.prisma.ts:248-288`,
  `services/attendance/src/events.ts`).
- `EventEnvelope` and the canonical `EVENT_TYPES` map live in
  `packages/events/src/index.ts:10-49`; there are **no per-type payload schemas** —
  `payload` is `z.record(z.unknown())`. So the only `packages/events` change is two
  new keys in the map.
- `video_asset` has **no `org_unit_id`**; it has an optional `course_id`
  (`database/schema.sql:1098-1114`). `owner_id` is nullable (`ON DELETE SET NULL`).

## Decision

**1. Event registry (`packages/events/src/index.ts`).** Add two keys to `EVENT_TYPES`:
`VIDEO_READY: "video.ready"` and `VIDEO_FAILED: "video.failed"`. No payload schema is
added (none exist today); `payload` stays `z.record(z.unknown())`. `version` stays 1
(relay default).

**2. Payload contract** (minimal + stable; built by a new
`services/video/src/events.ts` so the prisma and memory stores produce identical
payloads):

`video.ready` payload:
| field | type | purpose |
| --- | --- | --- |
| `videoId` | string (uuid) | the `video_asset.id`; the join key every consumer uses |
| `courseId` | string \| null | search-index scoping / course-feed wiring (#319) |
| `title` | string | human display; reused as the notification message |
| `durationSeconds` | number | search facet / UI |
| `renditionCount` | number | "N qualities available" summary (URLs are large/volatile — fetched via `GET /videos/:id`) |
| `captionLangs` | string[] | BCP-47 tags for a11y / search facets |
| `ownerId` | string \| null | the uploader |
| `recipientIds` | string[] | `ownerId ? [ownerId] : []` — wires the existing notification fan-out |

`video.failed` payload:
| field | type | purpose |
| --- | --- | --- |
| `videoId` | string (uuid) | join key |
| `courseId` | string \| null | scoping |
| `title` | string | human display |
| `ownerId` | string \| null | the uploader |
| `reason` | string | short error class/message (truncated; never a stack/secret) |
| `recipientIds` | string[] | `ownerId ? [ownerId] : []` |

**Envelope mapping:** `type` = the new constant; `tenantId` = `ctx.tenantId`;
`actorId` = `ownerId ?? null`; `orgUnitId` = **`null`** (see consequences); `occurredAt`
= DB `now()`; `version` = 1.

**3. Emit location — same tx as the terminal status flip.** The outbox `INSERT`
lives in the **same `withTenant` transaction** as the status write, so there is no
event without the state change and no state change without the event (mirrors
`attendance.finalizeSession`):

- **Success:** extend the existing terminal-success method
  `VideoStore.setRenditionsAndDuration` (which already flips status→`ready`) to also
  insert the `video.ready` row, building the payload from the `RETURNING` row plus the
  renditions argument. The pipeline call site is **unchanged**.
- **Failure:** add a **dedicated** `VideoStore.markFailed(ctx, id, reason)` that sets
  status→`failed` and inserts `video.failed` in the same tx. The generic
  `setStatus` is **left untouched** so the non-terminal `transcoding` flip (and any
  other transition) does **not** emit an event. The pipeline `catch` branch calls
  `markFailed` instead of `setStatus(..., 'failed')`.

Both `store.prisma.ts` (real `event_outbox` INSERT) and `store.memory.ts` (push to an
in-memory `outbox` array exposed for tests) implement the change via the shared
`events.ts` builder, so test assertions on the memory store reflect the real payload.

## Options considered

- **(rejected) Emit from the pipeline after the store call** (a separate
  `store.emitOutbox` in its own tx): breaks atomicity — a crash between the status
  flip and the emit yields a `ready` asset with no event (or vice-versa). The outbox
  pattern exists precisely to avoid this.
- **(rejected) Overload generic `setStatus` to emit on `'failed'`:** `setStatus` also
  performs the non-terminal `'transcoding'` flip; gating emission on the status value
  inside a generic method is a hidden, fragile branch. A dedicated `markFailed` keeps
  the contract explicit and `setStatus` pure.
- **(rejected) Per-type zod payload schemas in `packages/events`:** none exist today;
  adding a registry for one producer is scope creep. Kept consistent with the current
  `z.record(z.unknown())` contract.
- **(rejected) Derive `orgUnitId` from `course_id` via a join:** `course_id` is a
  course reference, not an org unit; joining `course.org_unit_id` invents a mapping no
  consumer requires. `orgUnitId` stays `null` and `courseId` travels in the payload.

## Consequences

- **No schema change.** Both `event_outbox` and `video_asset` exist and are
  tenant-scoped in RLS; `schema-agent` is **not** required.
- **No relay change.** The relay forwards any `type`; the notification consumer fans
  out automatically because the payload carries `recipientIds` + `title`.
- **Notification wired for free**, search indexing is a future consumer that
  subscribes to these types later (out of scope here — we only produce).
- **Re-transcode re-emits `video.ready`.** `POST /videos/:id/transcode` re-runs the
  pipeline and emits a fresh `video.ready` (a new outbox row / message id each time).
  This is correct ("latest renditions available"); consumers must be idempotent on
  `videoId` (the relay/inbox dedupes by message id, not domain key).
- **`orgUnitId` is `null`** on these events; consumers needing the org unit resolve it
  from `courseId`.
