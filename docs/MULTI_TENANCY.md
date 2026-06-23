# Multi-Tenancy

**Decision: design for pooled, build the option to silo.** Every tenant-scoped
table carries `tenant_id` and a tenant catalog exists from day one. This costs
almost nothing upfront and unlocks a paid isolated-infrastructure tier later.

## Tiers

| Tier       | Isolation                          | Who                         | Cost   |
| ---------- | ---------------------------------- | --------------------------- | ------ |
| **pool**   | Shared Postgres DB + RLS by tenant | K-12 / SMB / trials         | lowest |
| **silo**   | Dedicated Neon DB/branch per tenant| Enterprise / Higher-Ed      | higher |
| **hybrid** | pool by default; promote to silo   | the platform default        | mixed  |

The schema is **identical** in pool and silo — only physical placement differs.
In silo the `tenant_id` column + RLS become redundant but are retained so there
is a single codebase and a no-code migration path.

## Pool isolation (defense in depth)

1. **Application filter** — every query is tenant-scoped in code.
2. **Engine-level RLS** — `database/policies/rls.sql` enables
   `ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` with a `tenant_isolation`
   policy on every tenant table. The policy compares `tenant_id` to the
   request-scoped GUC `app.tenant_id`.
3. **Least-privilege connection roles.** Runtime tenant isolation only holds if
   the connecting role **cannot bypass RLS** — Postgres exempts SUPERUSER, table
   **owners**, and `BYPASSRLS` roles from policies *even under* `FORCE ROW LEVEL
   SECURITY`. So this repo uses a **three-role model** (#290 + #291; see
   [`database/roles.sql`](../database/roles.sql) and
   [ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)):

   | Role | DSN | Privilege envelope |
   | ---- | --- | ------------------ |
   | **owner / migrator** (`lms` in compose) | `MIGRATION_DATABASE_URL` | SUPERUSER + table owner, RLS-exempt by design. Runs `schema.sql`, `rls.sql`, `roles.sql` and the seed — **never** runtime traffic. |
   | **control-plane** (`control_plane_user`) | `CONTROL_PLANE_DATABASE_URL` | `NOSUPERUSER NOBYPASSRLS`, non-owner. `SELECT` on every table plus a narrow write set — `INSERT/UPDATE/DELETE` on `tenant`, `tenant_admin_delegation`, `tenant_silo_migration` and `INSERT` on `event_outbox`. The principal behind `@lms/db.controlPlane()`. |
   | **runtime app** (`app_user`) | `DATABASE_URL` | `NOSUPERUSER NOBYPASSRLS`, non-owner. Full CRUD on every tenant-scoped table (incl. `event_outbox`), but **SELECT-only** on all five control-plane tables (`tenant`, `plan`, `permission`, `tenant_admin_delegation`, `tenant_silo_migration`). Used by every backend service per request. |

   Both runtime roles (`control_plane_user`, `app_user`) are `NOSUPERUSER
   NOBYPASSRLS` non-owners, so they **are** subject to `tenant_isolation`. This
   non-bypassing pair is the safety net that "catches the cases your code misses".

   > See [docs/RUNBOOK-prod-db-roles.md](RUNBOOK-prod-db-roles.md) for the prod
   > provisioning + verification steps (provision the app role on Supabase, apply
   > `database/roles.sql`, set the DSNs, and verify cross-tenant isolation live).

   **Two complementary isolation mechanisms.** Tenant-scoped tables carry
   `tenant_id` and are protected by `FORCE ROW LEVEL SECURITY` keyed on
   `app.tenant_id` (above). The five **control-plane** tables are deliberately
   *not* in `rls.sql`'s `tenant_tables` loop — they are global registries/catalogs
   — so their isolation is enforced by **GRANTs instead**: `app_user` can only
   read them, and the only writer is the `tenant` service via `controlPlane()`
   (which reads `CONTROL_PLANE_DATABASE_URL ?? DATABASE_URL`, connecting as
   `control_plane_user`). Because `control_plane_user` is `NOBYPASSRLS`, even its
   one tenant-scoped write — the transactional `event_outbox` INSERT inside
   `provisionTenant` — stays subject to the FORCE'd `tenant_isolation` policy.

### How the GUC is set

`@lms/db.withTenant()` wraps pool work in a transaction and sets the GUC for the
duration of that transaction only — so it cannot leak across requests on a reused
serverless connection:

```ts
await tx.$executeRawUnsafe(
  `SELECT set_config('app.tenant_id', $1, true)`, // true = transaction-local
  ctx.tenantId,
);
```

`current_tenant_id()` (in `schema.sql`) reads the `app.tenant_id` GUC for the RLS
predicate (`tenant_id = current_tenant_id()`). When the GUC is **unset** it returns
`NULL`, so the predicate matches nothing and **all rows are denied** — a connection
that forgets `withTenant` sees zero rows rather than leaking across tenants
(provided it connects as the non-bypassing `app_user`; see
[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)).

### Background work stays tenant-scoped (the relay)

The `event_outbox` relay shows the safety net working for non-request work. The
relay has no incoming tenant context, so it **enumerates active tenants from the
control-plane `tenant` registry** (read outside RLS) and then **drains each
tenant's unpublished `event_outbox` rows inside that tenant's own `app.tenant_id`
GUC transaction** (`withTenant`). Because the outbox is under `FORCE ROW LEVEL
SECURITY` and the relay connects as the non-superuser (NOBYPASSRLS) role, a naive
`SELECT … FROM event_outbox` with no GUC set returns **zero rows** — the engine
makes it impossible to read the outbox cross-tenant even from a background worker.
Consumers then dedupe per tenant via `event_inbox (consumer, message_id)` for
exactly-once-effective processing.

## Silo routing

For silo tenants, `withTenant()` resolves a **dedicated `PrismaClient`** keyed by
the tenant's database URL (cached). The URL is looked up from the **tenant
catalog** (control-plane `tenant.database_ref`) and resolved via the secret store
— never hard-coded.

```ts
if (ctx.tier === "silo") return work(siloClient(ctx.databaseUrl));
```

## Tenant catalog (control plane)

The `tenant` service owns the registry: `tenant_id → tier, region,
database_ref, status`. This is the **isolation authority**. Provisioning runs as
a saga (QStash-driven):

- **pool** tenant → just a catalog row + RLS context (no infra).
- **silo** tenant → provision a Neon project/branch, run migrations, register the
  catalog mapping, then emit `tenant.provisioned`.

## Tenant resolution

A request's tenant is derived from, in order:

1. **Subdomain** — `acme.lms.example.com`.
2. **JWT claim** — `tenantId` (+ `tier`) on the access token (see `@lms/auth`).
3. **`X-Tenant-Id` header** — service-to-service only.

The resolved `TenantContext { tenantId, tier, databaseUrl }` flows through every
service call and drives pool-vs-silo routing.

## Pool → silo migration triggers

Promote a tenant to silo when it:

- exceeds ~10–15% of a shared pool's capacity (noisy neighbor), or
- requires its own encryption keys (CMK), or
- requires residency in a region without a pool, or
- signs an enterprise contract demanding physical isolation.

## Pool → silo promotion saga (#3)

Promotion is a **compensating saga** owned by the control-plane `tenant` service
(`services/tenant/src/silo.*.ts`). Because the silo branch gets the **identical**
`schema.sql` + `rls.sql`, pool ↔ silo is schema-identical and **requires no
application code change** — the saga only writes to the `tenant` catalog and a
control-plane saga-state table.

### The injectable port

All infra-facing work sits behind `SiloProvisioningPort` (`silo.ts`) — exactly
like the SIS OneRoster client and the tenant offboarding ports — so the engine is
hermetic and testable with a fake (no Neon, no network):

| Port method | Purpose |
| ----------- | ------- |
| `createProject(tenantId, region)` | Stand up the dedicated Neon project (idempotent). |
| `createBranch(tenantId, projectId)` | Create the primary branch + its DSN secret-store ref. |
| `runMigrations(target)` | Apply `schema.sql` + `rls.sql` so the silo is schema-identical to pool. |
| `copyTenantData(tenantId, target)` | Bulk-copy this tenant's rows pool → silo for every tenant-scoped table (preserving per-row `tenant_id`). |
| `deprovision(tenantId, target)` | Compensation: tear down the project/branch (idempotent). |

Production wires the Neon REST adapter `createNeonSiloPort` (`silo.neon.ts`);
tests inject a fake.

### The five ordered steps

The pure engine `promoteToSilo(input, deps)` (`silo.saga.ts`) runs five steps,
each with a forward action and a compensation:

| # | Step | Forward | Compensation |
| - | ---- | ------- | ------------ |
| 1 | `provision` | `createProject` + `createBranch` → `SiloTarget` | `deprovision(target)` |
| 2 | `migrate` | `runMigrations(target)` | (covered by step-1 deprovision) |
| 3 | `copy` | `copyTenantData(tenantId, target)` | (data lives in the soon-deprovisioned branch) |
| 4 | `repoint` | `store.setDatabaseRef(id, target.databaseRef)` | `store.setDatabaseRef(id, prevRef)` |
| 5 | `flip` | `store.setTier(id, 'silo')` (+ activate if it was `provisioning`) | `store.setTier(id, prevTier)` (+ revert status) |

**Repoint (4) deliberately precedes flip (5)** so a partially-failed run never
leaves a `silo`-tier tenant whose `database_ref` is null (which the routing layer
above would treat as unroutable). The engine captures the prior `tier` and
`database_ref` at run start so a compensation reverts *exactly*.

### Rollback rule

On **any** step failure the engine runs the compensations of all *completed*
steps in **reverse order** — catalog first (cheap, local: revert
`database_ref`/`tier`), infra last (`deprovision` tears down the branch/project)
— then marks the run `rolled_back`. If a compensation itself throws, the run is
marked `compensation_failed` (surfaced for manual intervention, never silently
swallowed). This is the AC's rollback path; forward-resume of a partial run is a
non-goal — recovery is a fresh promote with a new idempotency key.

### Idempotency & saga state

Each run is one row of the **control-plane** `tenant_silo_migration` table (no
RLS — it records platform-operator actions, like `tenant_admin_delegation`).
`idempotency_key` is **UNIQUE**, so a re-POST with the same key returns the
existing run rather than starting a second saga. The row carries `status`
(`pending` → in-flight → `completed`/`rolled_back`/`compensation_failed`), the
captured prev-values, the `SiloTarget` once known, and `completed_steps[]` that
drives the reverse-order rollback.

### HTTP contract

| Method | Path | Behaviour |
| ------ | ---- | --------- |
| `POST` | `/tenants/:id/promote-to-silo` | Body `{ idempotencyKey, actorId?, region? }`. Validates the id is a uuid, the tenant exists, and `tier='pool'`. Runs the saga: **200** `{ migration, tenant }` on success; **409** `{ migration, failedStep }` on failure+rollback; **409** `already_silo` if not pool-tier; **409** `idempotency_key_conflict` on cross-tenant key reuse; **400** on a missing key/bad uuid; **404** unknown tenant. |
| `GET` | `/tenants/:id/silo-migration` | Read the latest run: `{ migration: { id, tenantId, status, completedSteps, target?, error?, startedAt, finishedAt } }`; **404** if none. |

`database_ref` (and the run's `target`) are surfaced only as **opaque
secret-store refs** — never a raw DSN. The route completes synchronously with the
fake adapter; the status endpoint plus a 202 path are designed in so the live
adapter can move bulk copy to async without an API break.

### Authorization

`POST /tenants/:id/promote-to-silo` is a **destructive control-plane action** and
carries **no in-service claim** — consistent with the whole control-plane surface,
including the equally destructive `POST /tenants/:id/offboard`. The
gateway/platform-admin **super-admin gate is MANDATORY** and must be in place
before this route is enabled in production (see follow-ups below).

### Follow-ups (not yet implemented)

1. **Live Neon adapter.** `silo.neon.ts` currently ships as a documented **stub**
   whose methods throw `not_implemented`. The real implementation — Neon REST
   `createProject`/`createBranch`, a secret-store **write** of the resulting
   `database_ref`, and prod `runMigrations`/`copyTenantData` (preserving per-row
   `tenant_id`) — is deferred. The saga engine, catalog repoint, and rollback ship
   now and are fully covered via the fake adapter.
2. **Mandatory upstream super-admin gate** for `POST /tenants/:id/promote-to-silo`
   at the gateway/platform-admin layer (consistent with the offboard route; no
   in-service claim is invented).

## Tenant-aware caching & analytics

- **Redis (Upstash)** keys are prefixed `t:{tenantId}:` — never shared across
  tenants.
- **Cross-tenant analytics** operate only over de-identified aggregates.

## Offboarding / export (FERPA/GDPR)

`GET /tenants/{id}/export` produces a OneRoster CSV + content archive. Deletion
fans a purge across all services (right to erasure). The institution owns its
student records; deletion on contract end is supported.
