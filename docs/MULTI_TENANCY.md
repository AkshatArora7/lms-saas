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
3. **Least-privilege connection role.** Runtime tenant isolation only holds if
   the connecting role **cannot bypass RLS** — Postgres exempts SUPERUSER, table
   **owners**, and `BYPASSRLS` roles from policies *even under* `FORCE ROW LEVEL
   SECURITY`. So this repo uses a **two-role model** (see
   [`database/roles.sql`](../database/roles.sql) and
   [ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)): a privileged
   **owner/migrator** role (`lms` in compose) runs `schema.sql`, `rls.sql`,
   `roles.sql` and the seed, while every backend service connects at runtime as
   `app_user` — `NOSUPERUSER NOBYPASSRLS`, non-owner, CRUD-only — which **is**
   subject to `tenant_isolation`. This non-bypassing role is the safety net that
   "catches the cases your code misses".

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

Migration: copy the tenant's rows into the new per-tenant DB (bulk copy), repoint
the catalog mapping, flip `tier` to `silo`. **No application code change.**

## Tenant-aware caching & analytics

- **Redis (Upstash)** keys are prefixed `t:{tenantId}:` — never shared across
  tenants.
- **Cross-tenant analytics** operate only over de-identified aggregates.

## Offboarding / export (FERPA/GDPR)

`GET /tenants/{id}/export` produces a OneRoster CSV + content archive. Deletion
fans a purge across all services (right to erasure). The institution owns its
student records; deletion on contract end is supported.
