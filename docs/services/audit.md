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
| `POST` | `/events` | Append an audit event (hash-chained). |
| `GET` | `/audit` | Query/verify the audit trail. |
| `POST` | `/dsar` | Initiate a data subject access/erasure request. |

## Events published

- `audit.dsar.completed`

## Events consumed

- `* (all mutating domain events are mirrored for audit)`

## Dependencies

- all services (event stream)
- Vercel Blob (DSAR export)

## Notes

Each record stores prev_hash to form a verifiable chain; retention jobs run on QStash schedule.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
