# tenant service

- **Port (dev):** 4002
- **Data shape:** control-plane DB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Tenant catalogue and lifecycle: provisioning saga, pool/silo routing, sub-tenant hierarchy (district -> school), feature flags, plan binding.

## Owned tables

`tenant`, `plan`, `subscription`, `tenant_setting`, `tenant_branding`, `tenant_admin_delegation`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/tenants` | Provision a tenant; pass parentTenantId to register a school sub-tenant under a district (inherits plan; promotes parent). |
| `GET` | `/tenants/{id}/children` | List/search a district's child sub-tenants (?q=). |
| `GET` | `/tenants/{id}/routing` | Resolve pool vs silo + database_ref for connection routing. |
| `GET` | `/tenants/{id}/subtree` | District roll-up: root + descendants (tenant_subtree()) for parent reporting/billing. |
| `PATCH` | `/tenants/{id}/flags` | Toggle feature flags / add-on entitlements. |
| `PUT` | `/tenants/{id}/branding` | Set white-label branding (logo, colours, theme, custom domain). |
| `GET` | `/tenants/{id}/branding` | Resolve effective branding (with parent inheritance). |
| `PUT` | `/tenants/{id}/settings/{key}` | Set a per-tenant governance setting (validated against the key catalog). |
| `GET` | `/tenants/{id}/settings` | Effective governance settings (catalog defaults + overrides). |
| `GET` | `/tenants/{id}/settings/{key}` | Effective value for one setting key. |
| `GET` | `/settings/catalog` | The catalog of known governance keys, types and defaults. |
| `GET` | `/tenants/{id}/export` | Offboarding export: OneRoster CSV + content archive (audited). |
| `POST` | `/tenants/{id}/offboard` | Purge a tenant's data across all services (verified, audited) and mark it deleted. |
| `POST` | `/tenants/{id}/delegations` | Delegate admin of a sub-tenant to a user (district -> school). |
| `GET` | `/tenants/{id}/delegations` | List active admin delegations for a sub-tenant. |
| `POST` | `/tenants/{id}/delegations/{did}/revoke` | Revoke a delegation. |
| `GET` | `/tenants/{id}/access-check` | Hierarchy-aware decision: may an actor administer this sub-tenant? |

## Events published

- `tenant.provisioning.started`
- `tenant.activated`
- `tenant.suspended`
- `tenant.subtenant.linked`
- `tenant.branding.updated`
- `tenant.data.exported`
- `tenant.data.purged`

## Events consumed

- `billing.subscription.changed (entitlements)`

## Dependencies

- Neon API (silo branch/project create)
- secret store (database_ref -> DSN)
- billing
- all tenant-scoped services (offboarding export/purge via gateway)
- audit (offboarding trail)

## Notes

Control-plane; `tenant` is NOT in the RLS tenant_tables loop. Provisioning is a saga with compensation (delete branch on failure). Offboarding orchestrates per-service export/purge behind ports; per-service admin export/erasure endpoints are the contract (unverified services surface as failed, never silent).

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
