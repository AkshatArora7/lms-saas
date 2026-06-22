# reporting service

- **Port (dev):** 4016
- **Data shape:** Postgres + JSONB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Tenant-scoped reporting bounded context: a catalogue of built-in report definitions and persisted report runs computed synchronously from existing LMS data via an injectable ReportRunner. Tenant-isolated by Postgres RLS.

## Owned tables

`report_definition`, `report_run`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/definitions` | List the caller-tenant's built-in report definitions (seeded lazily/idempotently per tenant). 400 `tenant_required` if no x-tenant-id. |
| `POST` | `/runs` | Create + execute a run for `{definitionKey, params?}` synchronously via the injected ReportRunner; persists the outcome and returns `{run}`. Unknown/blank key -> 400 (no run persisted); runner success -> 201 status='succeeded' with result+row_count; runner failure -> 200 status='failed' with error. requested_by from x-user-id. |
| `GET` | `/runs` | List the caller-tenant's runs newest-first (RLS-scoped). |
| `GET` | `/runs/{id}` | Read one run incl. its `result` jsonb; 404 `not_found` if unknown (or owned by another tenant). |
| `GET` | `/health` | Liveness/readiness. |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- enrollment (enrollment table, direct RLS-scoped read)
- course (course table, direct RLS-scoped read)

## Notes

Owns `report_definition` (per-tenant catalogue of built-in reports, UNIQUE (tenant_id, key), seeded idempotently via `INSERT ... ON CONFLICT (tenant_id, key) DO NOTHING`) and `report_run` (one persisted execution: status queued|running|succeeded|failed, params/result jsonb, row_count, error, created_at/completed_at). Two built-in reports compute under the SAME RLS `withTenant` GUC scope over existing tenant-scoped tables: `enrollment-summary` (`enrollment` GROUP BY status -> `{total, byStatus:[{status,count}]}`) and `course-completion-summary` (`course LEFT JOIN enrollment` -> `{courses:[{courseId,title,enrolled,completed}]}`). Heavy work sits behind an injectable `ReportRunner` seam (mirroring ADR-0028/0029): default `DbReportRunner` reads real tables under `withTenant`; a deterministic `FakeReportRunner` lets the full suite run offline (memory store, no DB/network). Per-tenant isolation: both tables are under FORCE RLS (`tenant_isolation`) and EVERY store method + the DbReportRunner aggregations run inside `withTenant` -- tenant_id is stamped from ctx, never client-supplied; `requested_by` is sourced only from x-user-id (ADR-0027). HTTP request/response only -- no outbox/inbox events wired yet. Cron/scheduling and external delivery (email/CSV-to-blob) are deliberate follow-ups; the course-completion join granularity is tracked as a non-blocking correctness follow-up (#323). See [ADR-0030](../ADR-0030-reporting-service.md).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
