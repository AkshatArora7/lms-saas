# billing service

- **Port (dev):** 4022
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Plans and per-tenant subscriptions (trialing->active->past_due->canceled), seats and seat enforcement, usage metering and invoice generation (incl. district-consolidated invoices across sub-tenants).

## Owned tables

`plan`, `subscription`, `invoice`, `usage_meter`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/plans` | List the plan catalog (code, price, billing model, add-ons). |
| `POST` | `/tenants/{id}/subscription` | Subscribe a tenant to a plan (defaults to trialing). |
| `GET` | `/tenants/{id}/subscription` | The tenant's current subscription. |
| `POST` | `/tenants/{id}/subscription/transition` | Lifecycle transition (validated state machine). |
| `PUT` | `/tenants/{id}/subscription/seats` | Set the seat count. |
| `GET` | `/tenants/{id}/subscription/seat-check` | Seat enforcement against an active-user count. |
| `POST` | `/tenants/{id}/usage` | Record a usage meter rollup (metric + quantity over a window). |
| `GET` | `/tenants/{id}/usage/rollup` | Sum a metric's usage, optionally within [from, to). |
| `POST` | `/tenants/{id}/invoices` | Generate an invoice from the subscription plan + metered usage. |
| `GET` | `/tenants/{id}/invoices` | List the tenant's invoices. |
| `GET` | `/tenants/{id}/invoices/consolidated` | District-consolidated invoice across the tenant subtree. |

## Events published

- `billing.subscription.changed`

## Events consumed

- `enrollment.created (seat reservation, roadmap)`
- `tenant.activated`

## Dependencies

- tenant (registry)
- payment provider (Stripe, roadmap)

## Notes

plan is the global control-plane catalog; subscription/invoice/usage_meter are tenant-scoped under RLS. Consolidated invoicing is a deliberate control-plane roll-up bounded to tenant_subtree(); add-on enablement and the seat-reservation saga remain follow-ups.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
