# tenant service

- **Port (dev):** 4002
- **Data shape:** control-plane DB
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

Tenant catalogue and lifecycle: provisioning saga, pool/silo routing and pool->silo promotion, sub-tenant hierarchy (district -> school), feature flags, plan binding.

## Owned tables

`tenant`, `plan`, `subscription`, `tenant_setting`, `tenant_branding`, `tenant_admin_delegation`, `tenant_silo_migration`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/tenants` | Provision a tenant; pass parentTenantId to register a school sub-tenant under a district (inherits plan; promotes parent). |
| `GET` | `/tenants/{id}/children` | List/search a district's child sub-tenants (?q=). |
| `GET` | `/tenants/{id}/routing` | Resolve pool vs silo + database_ref for connection routing. |
| `GET` | `/tenants/{id}/subtree` | District roll-up: root + descendants (tenant_subtree()) for parent reporting/billing. |
| `PATCH` | `/tenants/{id}/flags` | Toggle feature flags / add-on entitlements. |
| `PUT` | `/tenants/{id}/branding` | Set/override white-label branding (logo, favicon, palette, light/dark theme, custom domain, custom CSS, support email; hex colours validated). |
| `GET` | `/tenants/{id}/branding` | Resolve effective branding -> {branding (inheritance-resolved: sub-tenant override -> parent district -> platform default), overrides (this tenant's own row)}. |
| `GET` | `/tenants/by-domain/{host}` | Pre-auth, control-plane: resolve a custom domain (Host) to its tenant via tenant_branding.custom_domain (citext UNIQUE). Returns only {tenantId}; 404 when no tenant claims the host. Lets the learner web app brand a custom-domain landing/login screen at the edge before any session exists. |
| `PUT` | `/tenants/{id}/settings/{key}` | Set a per-tenant governance setting (validated against the key catalog). |
| `GET` | `/tenants/{id}/settings` | Effective governance settings (catalog defaults + overrides). |
| `GET` | `/tenants/{id}/settings/{key}` | Effective value for one setting key. |
| `GET` | `/settings/catalog` | The catalog of known governance keys, types and defaults. |
| `GET` | `/tenants/{id}/export` | Offboarding export: OneRoster CSV + content archive (audited). |
| `POST` | `/tenants/{id}/offboard` | Purge a tenant's data across all services (verified, audited) and mark it deleted. |
| `POST` | `/tenants/{id}/promote-to-silo` | Promote a pool tenant to a dedicated silo DB via a compensating saga (provision -> migrate -> bulk-copy -> repoint database_ref -> flip tier=silo); idempotent on body `idempotencyKey`. 200 {migration, tenant} on success; 409 {migration, failedStep} on failure+rollback; 409 `already_silo` if not pool-tier; 409 `idempotency_key_conflict` on cross-tenant key reuse. Destructive control-plane action -- gated upstream (gateway/platform-admin), no in-service claim. |
| `GET` | `/tenants/{id}/silo-migration` | Read the tenant's latest silo-promotion run: {migration:{id, tenantId, status, completedSteps, target?, error?, startedAt, finishedAt}}; 404 if none. target surfaces only opaque refs (projectId/branchId/databaseRef), never a raw DSN. |
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

Control-plane; `tenant` is NOT in the RLS tenant_tables loop. Provisioning is a saga with compensation (delete branch on failure). Pool->silo PROMOTION (#3) is a separate compensating saga in `services/tenant/src/silo.*`: a pure engine (`silo.saga.ts`) runs five ordered steps -- provision (Neon project+branch) -> migrate (apply schema.sql+rls.sql so silo is schema-identical) -> bulk-copy the tenant's rows -> repoint catalog `database_ref` -> flip `tier=silo` -- behind an injectable `SiloProvisioningPort` (prod = Neon REST adapter `silo.neon.ts`, tests = fake), exactly like the offboarding ports. Because the silo gets the identical `schema.sql`+`rls.sql`, pool<->silo is schema-identical and requires NO application code change. On ANY step failure the engine runs the completed steps' compensations in REVERSE order (catalog reverts first -- `setDatabaseRef`/`setTier` back to prior values -- then `deprovision` tears down infra last), marking the run `rolled_back` (or `compensation_failed` if a compensation itself throws, surfaced for manual intervention). repoint precedes flip so a partial run never leaves a silo-tier tenant whose `database_ref` is null. Each run is one row of the control-plane `tenant_silo_migration` table; `idempotency_key` is UNIQUE so a re-POST returns the existing run rather than starting a second saga (a cross-tenant key reuse is rejected 409, never echoing another tenant's refs). `database_ref` is an OPAQUE secret-store ref end-to-end -- never a raw DSN -- and is never logged or returned. FOLLOW-UPS (NOT yet implemented): (1) the LIVE Neon adapter -- `silo.neon.ts` ships as a documented STUB whose methods throw `not_implemented`; the real impl (Neon REST createProject/branch + secret-store WRITE of `database_ref` + prod `runMigrations`/`copyTenantData` preserving per-row `tenant_id`) is deferred; the saga engine + catalog repoint + rollback ship now and are fully covered via the fake adapter. (2) the MANDATORY upstream super-admin gate -- the destructive `POST /tenants/:id/promote-to-silo` carries NO in-service claim (consistent with the whole control-plane surface incl. the equally destructive `POST /tenants/:id/offboard`); it MUST be gated at the gateway/platform-admin layer before prod enablement. Offboarding orchestrates per-service export/purge behind ports; per-service admin export/erasure endpoints are the contract (unverified services surface as failed, never silent). White-label branding (#89/#12) is per-tenant including sub-tenants: `tenant_branding` stores logo/favicon/palette/theme/custom_domain/custom_css/support_email, and the SQL function `tenant_effective_branding()` walks the parent chain to resolve effective branding with the precedence sub-tenant override -> parent district -> platform default (theme/custom_domain/custom_css are tenant-specific, not inherited). `GET /tenants/by-domain/:host` is the pre-auth, control-plane host->tenant lookup the learner web app calls at the edge for custom domains; it is safe at control-plane because `custom_domain` is globally unique and the response carries only the opaque tenant id. See [DEPLOYMENT.md](../DEPLOYMENT.md#custom-domains-white-label-at-the-edge) for the Vercel custom-domain ops procedure, and [MULTI_TENANCY.md](../MULTI_TENANCY.md#pool--silo-promotion-saga-3) for the silo-promotion saga.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
