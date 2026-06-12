# billing service

- **Port (dev):** 4022
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Plans, seats, invoices, usage metering, and the enrollment+billing saga participant.

## Owned tables

`invoice`, `usage_meter`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/seats/reserve` | Reserve a seat for an enrollment (saga step). |
| `GET` | `/tenants/{id}/invoices` | Invoice history. |
| `POST` | `/usage` | Record a usage meter reading. |

## Events published

- `billing.seat.reserved`
- `billing.seat.rejected`
- `billing.subscription.changed`
- `invoice.issued`

## Events consumed

- `enrollment.created (reserve)`
- `enrollment.dropped (release)`
- `tenant.activated`

## Dependencies

- tenant (plan/subscription)
- payment provider (Stripe)

## Notes

Saga participant for seat reservation; district parent tenants can be billed via tenant_subtree() roll-up.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
