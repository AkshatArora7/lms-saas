# tenant service

- **Port (dev):** 4002
- **Data shape:** control-plane DB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Tenant catalogue and lifecycle: provisioning saga, pool/silo routing, sub-tenant hierarchy (district -> school), feature flags, plan binding.

## Owned tables

`tenant`, `plan`, `subscription`, `tenant_setting`, `tenant_branding`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/tenants` | Provision a tenant or sub-tenant (kind=standalone\|parent\|sub). |
| `GET` | `/tenants/{id}/routing` | Resolve pool vs silo + database_ref for connection routing. |
| `GET` | `/tenants/{id}/subtree` | District roll-up: tenant_subtree() ids for parent reporting/billing. |
| `PATCH` | `/tenants/{id}/flags` | Toggle feature flags / add-on entitlements. |
| `PUT` | `/tenants/{id}/branding` | Set white-label branding (logo, colours, theme, custom domain). |
| `GET` | `/tenants/{id}/branding` | Resolve effective branding (with parent inheritance). |
| `PUT` | `/tenants/{id}/settings/{key}` | Set a per-tenant governance setting (validated against the key catalog). |
| `GET` | `/tenants/{id}/settings` | Effective governance settings (catalog defaults + overrides). |
| `GET` | `/tenants/{id}/settings/{key}` | Effective value for one setting key. |
| `GET` | `/settings/catalog` | The catalog of known governance keys, types and defaults. |

## Events published

- `tenant.provisioning.started`
- `tenant.activated`
- `tenant.suspended`
- `tenant.subtenant.linked`
- `tenant.branding.updated`

## Events consumed

- `billing.subscription.changed (entitlements)`

## Dependencies

- Neon API (silo branch/project create)
- secret store (database_ref -> DSN)
- billing

## Notes

Control-plane; `tenant` is NOT in the RLS tenant_tables loop. Provisioning is a saga with compensation (delete branch on failure).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
