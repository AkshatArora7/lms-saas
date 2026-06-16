# audit service

- **Port (dev):** 4023
- **Data shape:** Postgres (ledger)
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Tamper-evident hash-chained audit logs, DSAR (data subject access) fulfilment, retention enforcement.

## Owned tables

`audit_log`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/audit/events` | Append a tamper-evident audit event (links to the tenant's hash chain). |
| `GET` | `/audit/events` | List recent entries (filter by actorId, targetType, limit). |
| `GET` | `/audit/verify` | Re-hash the tenant's chain and report the first break (verification job). |

## Events published

_None_

## Events consumed

- `* (mutating domain events can be mirrored for audit)`

## Dependencies

- all services (callers append audit events)

## Notes

Per-tenant hash chain over audit_log.prev_hash/row_hash (SHA-256 of prev||row payload). /audit/verify is the tamper-detection job (run on a QStash/cron schedule). DSAR fulfilment and retention enforcement are tracked follow-ups.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
