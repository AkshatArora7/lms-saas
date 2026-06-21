# ADR-0026 — Two-role DB model: least-privilege runtime app role so RLS is enforced

- **Status:** Accepted · 2026-06-21
- **Issue:** #286 — fix(infra): runtime DATABASE_URL must use a NOSUPERUSER/NOBYPASSRLS app role so RLS is enforced
- **Owning scope:** `database/` (schema-agent), `docker-compose.yml` (infra), docs
- **Author:** Architect agent

## Context

Tenant isolation in the pool tier rests on three layers
(`docs/MULTI_TENANCY.md:19-27`): the app-level filter, engine-level
`FORCE ROW LEVEL SECURITY` with the `tenant_isolation` policy
(`database/policies/rls.sql:42-54,64-77`), and the request-scoped GUC
`app.tenant_id` set by `@lms/db.withTenant()`
(`packages/db/src/index.ts:59-65`). The RLS predicate is
`tenant_id = current_tenant_id()`, where `current_tenant_id()` reads the GUC and
returns `NULL` when unset (`database/schema.sql:21-24`, `current_setting(..., true)`
+ `NULLIF`).

**The control is declared but not enforced at runtime.** Every service shares the
`x-common-env` anchor whose `DATABASE_URL` defaults to
`postgresql://lms:lms@postgres:5432/lms` (`docker-compose.yml:47`, anchored at
lines 41-53). The in-compose Postgres role `lms` is the `POSTGRES_USER`
(`docker-compose.yml:70-72`) — it is a **SUPERUSER and table owner**, and
Postgres exempts SUPERUSER / `BYPASSRLS` roles from **all** RLS policies even when
`FORCE ROW LEVEL SECURITY` is set. qa-agent proved the consequence in the live
stack: a request with `x-tenant-id: 2222…` returned tenant `1111…`'s rows. The
documented expectation that "the app connects as a non-superuser role"
(`SETUP.md:146-148`, `docs/MULTI_TENANCY.md:26`) is **not true at runtime**.

The fix already has a proven reference: the integration tests create a dedicated
`NOSUPERUSER NOBYPASSRLS` role `lms_rls_app` and connect through it to prove
isolation (`tests/integration/src/helpers/db.ts:20-21,86-104`). That role recipe
is what the runtime must adopt.

## Decision

Adopt an explicit **two-role model**, mirroring the integration-test reference:

1. **Migration / owner role** (privileged) — owns the schema, applies
   `schema.sql` + `rls.sql` + `roles.sql`, and runs the seed. In compose this
   stays the existing `lms` superuser (`POSTGRES_USER`). Used **only** by
   migrations and the one-shot `seed` service — never by a runtime service.

2. **Runtime app role** `app_user` (least-privilege) —
   `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, **not** a table owner,
   granted only `USAGE` on schema, `SELECT/INSERT/UPDATE/DELETE` on app tables,
   and `USAGE, SELECT` on sequences. Because `FORCE ROW LEVEL SECURITY` is on,
   this role is fully subject to `tenant_isolation`. Every service's runtime
   `DATABASE_URL` connects as `app_user`.

Role creation + grants live in a new **`database/roles.sql`**, applied after
schema + RLS (mounted as `/docker-entrypoint-initdb.d/03-roles.sql`, and runnable
standalone against real deploys). The exact statements mirror
`tests/integration/src/helpers/db.ts:86-104` (including `ALTER DEFAULT PRIVILEGES`
so tables created by future migrations are auto-granted to `app_user`).

`withTenant`'s `SELECT set_config('app.tenant_id', $1, true)` needs **no special
privilege**: `app.tenant_id` is a custom (placeholder) GUC class, settable by any
role at transaction scope — so isolation now actually enforces under `app_user`.

## Consequences

- **Tenant isolation becomes real** — the `2222… sees 1111…` repro can no longer
  happen because the runtime role can no longer bypass RLS.
- **`withTenant` becomes a true safety net** rather than a no-op decoration.
- **Seed still works** as the privileged owner (it writes across tenants / the
  control-plane registry); no seed code change.
- **New operational contract:** real/Supabase deploys must run `roles.sql` as a
  migration step and point service `DATABASE_URL` at `app_user` while migrations
  use a separate privileged URL. Documented in `SETUP.md` / `docs/MULTI_TENANCY.md`.
- **Risk:** if grants are too narrow a service 500s on a missing privilege; the
  `ALL TABLES` + `ALL SEQUENCES` + `ALTER DEFAULT PRIVILEGES` grants mitigate it.
- **initdb caveat:** the mounted scripts only run on an empty data volume;
  existing volumes (or Supabase) need `roles.sql` applied explicitly.

## Alternatives considered

- **(A) Keep `lms` but remove SUPERUSER/BYPASSRLS from it** — rejected: `lms`
  also **owns** the tables, and an owner is still subject to RLS only because of
  `FORCE`, but it would then also need to run migrations/seed that legitimately
  span tenants; conflating owner and runtime roles re-creates the footgun. A
  distinct non-owner runtime role is the defensible boundary.
- **(B) Per-service DB roles** — rejected as premature: all services share the
  same isolation contract; one `app_user` is simpler and matches the test
  reference. Per-service roles can be layered later if least-privilege per
  bounded context is ever needed.
- **(C) Create the role inside the seed job instead of `roles.sql`** — rejected:
  role/grant provisioning is a migration concern, not seed data; co-locating it
  with schema application keeps ownership with schema-agent and works even when
  the demo seed is skipped.
