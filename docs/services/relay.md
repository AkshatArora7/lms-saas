# relay service

- **Port (dev):** 4026
- **Data shape:** Postgres (event_outbox/event_inbox)
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Transactional-outbox relay / event publisher. A long-running worker that drains each tenant's unpublished `event_outbox` rows and publishes the domain events through a transport to consumers. The Fastify app exists only to expose a liveness endpoint and a manual trigger; it is not a request/response domain service.

## Owned tables

_None_ (stateless or operates on derived/index data only).

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness/readiness (reports tenant mode and uptime). |
| `POST` | `/relay/run` | Run one drain pass now (ops/manual trigger); the worker also runs this on a timer. |

## Events published

- `* (republishes any event_outbox row to consumers)`

## Events consumed

_None_

## Dependencies

- tenant (control-plane registry — active tenants to drain)
- notification (POST /events consumer)

## Notes

Enumerates active tenants from the control-plane `tenant` registry (read outside RLS), then drains each tenant INSIDE its own `app.tenant_id` GUC transaction via `@lms/db.withTenant`. `event_outbox` is under FORCE ROW LEVEL SECURITY and the app connects as a NOBYPASSRLS role, so the relay can never read the outbox cross-tenant. Oldest-first delivery preserves causal order; only delivered rows are stamped `published_at` (re-guarded `IS NULL` so a concurrent relay can't double-stamp). Transport is abstracted (`@lms/events` EventTransport seam): in-process / HTTP by default, a hosted QStash/Upstash transport is a future seam (not implemented; no secrets hard-coded). Today notification is the only wired consumer (`enrollment.created`, `grade.released`); analytics is not yet wired.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
