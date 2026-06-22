# ADR-0030 — Reporting service: store-abstraction + injectable ReportRunner seam, built-in reports computed synchronously under RLS

- **Status:** Accepted · 2026-06-21
- **Issue:** #322 — feat(reporting): complete reporting service — report definitions + persisted runs (epic #59)
- **Owning scope:** `services/reporting` (bounded context) — docs
- **Author:** Architect agent (recorded by docs-agent)

## Context

The `reporting` service (port 4016) was the last health-only stub remaining in the
microservice decomposition (`ai` and `video` were already completed — see
[ADR-0028](ADR-0028-ai-rag-study-assistant.md) and
[ADR-0029](ADR-0029-video-upload-transcode-pipeline.md)). Issue #322 asks it to
become a real tenant-scoped bounded context: expose a catalogue of built-in report
definitions, and let a caller create a **persisted report run** that is computed
from existing LMS data and stored with its result — all **tenant-isolated** by the
platform's existing Postgres RLS.

The acceptance criteria are: list the seeded built-in definitions per tenant
(AC#1); create a run that executes synchronously, persists `status='succeeded'`
with a `result` jsonb + `row_count`, with unknown key / invalid params yielding a
4xx or a persisted `failed` run (AC#2); list runs newest-first and read one by id
including its result, 404 on unknown (AC#3); strict tenant isolation via RLS +
`x-tenant-id` (AC#4); ship the two new tenant-scoped tables in `schema.sql` +
`rls.sql` (AC#5); and follow the store-abstraction pattern with an injectable
runner seam plus deterministic offline tests, explicitly deferring cron/scheduling
and external delivery (AC#6).

Two constraints shaped the design, mirroring the ADR-0028/0029 precedent:

1. **Report computation must read several existing tenant-scoped tables** (today
   `enrollment` and `course`) — and it must do so **without ever crossing the
   tenant boundary**, i.e. inside the same RLS GUC scope as the rest of the
   service.
2. **Tests and CI must run offline with no DB and no network.** The repo's
   verification gates run key-free; a service whose run execution hard-depended on
   a live database at import or boot time would break them.

## Decision

### 1. Bounded context + two owned tables

The `reporting` service owns `report_definition` (a per-tenant catalogue of
built-in reports, `UNIQUE (tenant_id, key)`) and `report_run` (one persisted
execution). Both carry their own `tenant_id uuid NOT NULL REFERENCES tenant(id) ON
DELETE CASCADE`, so they were appended to the `tenant_tables` array in
`database/policies/rls.sql` and pick up the standard `tenant_isolation` policy
(`ENABLE` + `FORCE ROW LEVEL SECURITY`, `USING/WITH CHECK tenant_id =
current_tenant_id()`) with no join-based policy needed (pglast: schema.sql OK,
rls.sql OK). `report_run` records `status IN
('queued','running','succeeded','failed')`, `params`/`result` jsonb, `row_count`,
`error`, and `created_at`/`completed_at`, with `ix_report_run_tenant_created
(tenant_id, created_at DESC)` backing the newest-first listing.

The surface is mounted at the service root and exposed behind the gateway as
`/api/reporting/*`. Tenant comes from the gateway-stamped trusted `x-tenant-id`
(`headerTenantResolver` -> 400 `tenant_required` if absent); `requested_by` is
sourced only from the trusted `x-user-id` (see
[ADR-0027](ADR-0027-trusted-identity-headers.md)), never from the client body. No
gateway or compose change was required — both were already wired generically
(`SERVICE_URL_REPORTING`).

### 2. Store-abstraction pattern (offline-testable by construction)

Following the `ai`/`video` precedent, persistence is behind a `ReportStore`
interface with two implementations:

- **`MemoryReportStore`** — tenant-filtered in-memory arrays; built-ins seeded
  lazily per tenant; runs listed newest-first deterministically. Used by the
  offline Vitest suite (no DB, no network).
- **`createPrismaStore` (`store.prisma.ts`)** — every method (`listDefinitions`,
  `getDefinitionByKey`, `createRun`, `getRun`, `listRuns`) wraps `withTenant`;
  built-ins seeded idempotently via `INSERT ... ON CONFLICT (tenant_id, key) DO
  NOTHING`; all raw SQL uses bound params with `$n::uuid` / `$n::jsonb` casts
  (uuid=text rule #267).

### 3. Injectable `ReportRunner` seam + synchronous execution

Run execution sits behind a `ReportRunner` interface so the service is offline by
default and a real (or future async) runner can drop in with no caller changes —
this mirrors the ADR-0028 `Embedder`/`ChatModel` and ADR-0029
`Transcoder`/`Captioner` seams exactly.

- **Default `DbReportRunner`** computes the two built-in reports under the SAME
  `withTenant` GUC scope as the store, over existing tenant-scoped tables:
  - `enrollment-summary`: `enrollment` GROUP BY status ->
    `{total, byStatus:[{status,count}]}`, `row_count` = number of status groups.
  - `course-completion-summary`: `course LEFT JOIN enrollment` per-course enrolled
    vs completed counts -> `{courses:[{courseId,title,enrolled,completed}]}`,
    `row_count` = number of courses.
- **`FakeReportRunner`** is a deterministic offline default for tests.

`POST /runs` executes the run **synchronously** in the request path and persists
the outcome. The unknown-key vs failed-run contract is explicit: a missing/blank
or unknown `definitionKey` yields **400** with **no run persisted** (checked before
creating a run); a runner **execution failure** (valid key but the runner throws)
persists a **`status='failed'`** run with `error` + `completed_at` and returns
**200**; a runner success persists a **`status='succeeded'`** run with
result+row_count+completed_at and returns **201**.

### 4. Tenant isolation (ADR-0026)

Tenant isolation is the sacred boundary and is unchanged from the platform model.
The runtime connects as `app_user` (`NOBYPASSRLS`, see
[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)); both tables have `FORCE
ROW LEVEL SECURITY` + the `tenant_isolation` policy; and **every** `ReportStore`
method **and** the `DbReportRunner` aggregations run inside `withTenant(ctx, ...)`.
No query runs outside the GUC scope, so the report computation can never read
another tenant's `enrollment`/`course` rows. `tenant_id` is stamped from `ctx` on
INSERT, never client-supplied; a `GET /runs/{id}` for another tenant's run is
invisible under RLS -> `getRun` returns `null` -> **404**.

## Consequences

- **The service is offline by default.** It boots and its full unit suite (11/11)
  passes with no DB and no network, because the store has a memory implementation
  and run execution is behind the `FakeReportRunner` seam. Adding a real or async
  runner is purely additive behind the existing interface.
- **Cross-tenant access is impossible by construction.** Every store method and
  the runner aggregations run under FORCE RLS + `withTenant`; a two-tenant test
  proves tenant B sees an empty list and 404 on read of tenant A's run.
- **No domain events yet.** This slice is HTTP request/response only; the service
  publishes/consumes nothing on the outbox/inbox and is not wired into `relay`.
- **Run execution is synchronous in the request path** — acceptable while the
  built-in reports are bounded aggregations, but heavy or long-running reports
  would need a job/queue model before they land.

## Future work (non-blocking follow-ups)

- **Cron / scheduled runs** (e.g. a QStash-triggered schedule) behind the same
  `ReportRunner` seam — explicitly out of scope for this story.
- **External delivery** (email, CSV/PDF export to Blob with signed URLs) — out of
  scope for this story.
- **course-completion-summary join granularity (#323):** the current
  `course LEFT JOIN enrollment` joins on `org_unit_id`, but enrollments are created
  at `section` granularity while `course.org_unit_id` is the course-offering org
  unit, so per-course counts can under-report. Tracked as a non-blocking
  correctness follow-up routed to service-builder — it is a data-semantic bug, not
  a tenant-isolation/authz defect.
- **Live-DB RLS integration test** for `report_definition`/`report_run` (offline
  tests prove isolation on the memory store; a live integration test is a
  recommended follow-up).
- **Outbox `report.run.completed` events** + `relay` wiring if other services need
  to react to completed runs.

## Alternatives considered

- **(A) Asynchronous job execution (queue/worker) now** — rejected as scope: the
  built-in reports are bounded aggregations, so synchronous execution behind the
  `ReportRunner` seam models the contract honestly; a real async runner drops in
  behind the same interface as a follow-up.
- **(B) A mandatory live DB for run execution (no fake runner)** — rejected: it
  would break key-free/offline qa and make the module un-testable without a
  database. The injectable runner keeps the service offline by default.
- **(C) Reading the data via the enrollment/course services over HTTP** — rejected:
  the report computation reads the existing tenant-scoped tables directly via
  `@lms/db` `withTenant` (same precedent as `ai` reading `content_topic.body`),
  keeping it inside one RLS transaction with no cross-service fan-out.
- **(D) A join-based RLS policy on the new tables** — unnecessary: both tables
  carry their own `tenant_id`, so the standard `tenant_isolation` policy applies
  directly.
