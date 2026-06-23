# Runbook — Provision the prod DB roles & enforce RLS at runtime

> **Purpose.** Enforce tenant isolation in production by running every runtime
> service as a least-privilege `NOSUPERUSER NOBYPASSRLS` non-owner app role
> (`app_user`) while migrations and seeds run as the privileged owner/migrator.
> This runbook is the **operator action** that completes the *live-DB* acceptance
> criteria of **#290** — the steps the repo and CI cannot execute themselves. It
> complements the repo wiring landed for #290 (the `MIGRATION_DATABASE_URL`
> split) and the three-role model shipped in **#291**
> ([`database/roles.sql`](../database/roles.sql)).

This runbook is **hand-authored** and **operator-actionable** top to bottom. Run
it once per environment (and re-run idempotently when rotating passwords or
re-provisioning).

---

## Why this matters

Tenant isolation in the pool tier rests on `FORCE ROW LEVEL SECURITY` plus the
`tenant_isolation` policy in [`database/policies/rls.sql`](../database/policies/rls.sql),
keyed on the request-scoped `app.tenant_id` GUC set by `@lms/db.withTenant()`.

**Postgres exempts SUPERUSER roles, table OWNERS, and `BYPASSRLS` roles from
every RLS policy — *even under* `FORCE ROW LEVEL SECURITY`.** So if a runtime
service connects as a superuser, the table owner, or a `BYPASSRLS` role, the
policy is silently bypassed and one tenant can read another tenant's rows. The
fix is operational: runtime traffic **must** connect as a non-owner
`NOSUPERUSER NOBYPASSRLS` role so the policy actually applies.

See **[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)** (the decision)
and **[docs/MULTI_TENANCY.md](MULTI_TENANCY.md)** (the three-role table and the
GUC mechanism).

---

## The three roles

| Role | DSN env var | Privilege envelope | Used by |
| ---- | ----------- | ------------------ | ------- |
| **owner / migrator** (`lms` in compose; **`postgres` on Supabase**) | `MIGRATION_DATABASE_URL` | SUPERUSER + table owner, RLS-exempt **by design**. Runs `schema.sql`, `rls.sql`, `roles.sql` and the seed. | `pnpm db:migrate` / `pnpm db:seed` and the `db-migrate.yml` DDL applies **only** — never runtime traffic. |
| **control-plane** (`control_plane_user`) | `CONTROL_PLANE_DATABASE_URL` | `NOSUPERUSER NOBYPASSRLS`, non-owner. `SELECT` on every table + a narrow write set (`INSERT/UPDATE/DELETE` on `tenant`, `tenant_admin_delegation`, `tenant_silo_migration`; `INSERT` on `event_outbox`). | `@lms/db.controlPlane()` (the `tenant` service's provisioning path). |
| **runtime app** (`app_user`) | `DATABASE_URL` | `NOSUPERUSER NOBYPASSRLS`, non-owner. Full CRUD on every tenant-scoped table (incl. `event_outbox`), **SELECT-only** on the five control-plane tables. Fully subject to `tenant_isolation`. | Every backend service, per request. |

> **⚠️ Supabase owner-name caveat.** On Supabase the database **owner is
> typically `postgres`, not `lms`**. [`database/roles.sql`](../database/roles.sql)
> references the owner role by name in its `ALTER DEFAULT PRIVILEGES FOR ROLE lms
> …` statements. When applying that file on Supabase/prod you **must adapt those
> owner references from `lms` to `postgres`** (or whatever your Supabase owner
> role is). The `CREATE ROLE`/`GRANT … TO app_user`/`… TO control_plane_user`
> statements are owner-name-independent and apply as-is.

---

## Step 1 — Provision the runtime app role (issue AC1)

Run as the Supabase **owner/`postgres`** principal — via the Supabase SQL editor,
or `psql` over the Supavisor pooler. Create the runtime role as a non-owner,
least-privilege login:

```sql
CREATE ROLE app_user
  LOGIN PASSWORD '<strong-app-secret>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
```

Provision the control-plane role the same way (only needed if you run the
control-plane DSN split rather than falling back to `app_user`):

```sql
CREATE ROLE control_plane_user
  LOGIN PASSWORD '<strong-control-plane-secret>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
```

> **Secrets:** generate strong, unique passwords and store them in your secret
> store (Fly secrets / GitHub Environment secrets / Supabase). **Never** commit a
> password, and never ship the compose dev defaults (`app_user`/
> `control_plane_user`) to prod. If a role already exists, rotate with
> `ALTER ROLE app_user PASSWORD '<new-secret>';` instead of recreating it.

---

## Step 2 — Apply the grants (`database/roles.sql`) (issue AC2)

Apply [`database/roles.sql`](../database/roles.sql) against prod using the
**privileged owner** DSN. This file is idempotent and creates the roles (if
absent) and grants the least-privilege envelopes — the
`GRANT … TO app_user` / `… TO control_plane_user` statements are the important
part.

> **Before applying:** edit the `ALTER DEFAULT PRIVILEGES FOR ROLE lms …`
> statements to name the **Supabase owner** (`postgres`) instead of `lms` (see
> the caveat above). The `CREATE ROLE` and `GRANT … TO …`/`REVOKE … FROM …`
> statements need no change.

```bash
# Run as the privileged owner/migrator DSN (direct, non-pooler host).
psql -v ON_ERROR_STOP=1 "$MIGRATION_DATABASE_URL" -f database/roles.sql
```

The dev-default passwords inside the file are only used by the guarded
`CREATE ROLE … IF NOT EXISTS` blocks; since you created the roles with strong
passwords in Step 1, those blocks are no-ops on prod and the file just applies
the grants/revokes.

---

## Step 3 — Set the deploy env / secrets (issue AC3)

Set these in your deploy environment (e.g. `flyctl secrets set`, GitHub
Environment secrets, Vercel env). Keep runtime and migration DSNs **separate**:

| Env var | Value | Notes |
| ------- | ----- | ----- |
| `DATABASE_URL` | `app_user` via the **Supavisor pooler** URL | Runtime DSN for every service. Use the pooler (IPv4) host. |
| `MIGRATION_DATABASE_URL` | privileged **owner/migrator** DSN | Consumed **only** by `pnpm db:migrate` / `pnpm db:seed` (the `with-migration-dsn.mjs` wrapper) and the `db-migrate.yml` DDL applies. |
| `CONTROL_PLANE_DATABASE_URL` | `control_plane_user` DSN | Control-plane writes. Falls back to `DATABASE_URL` if unset — set it explicitly for a hardened deploy. |

- **Runtime services must NOT have `MIGRATION_DATABASE_URL` set.** The wrapper
  only overrides the DSN for `db:migrate`/`db:seed`; a runtime service that had
  `MIGRATION_DATABASE_URL` in its env would still connect as `app_user` via
  `DATABASE_URL` (runtime code never reads `MIGRATION_DATABASE_URL`), but keeping
  it out of runtime env avoids any confusion and keeps the privileged secret off
  runtime hosts.
- **GitHub Actions:** set the repo/Environment secret **`MIGRATION_DATABASE_URL`**
  so `.github/workflows/db-migrate.yml` applies `schema.sql` / `rls.sql` /
  `roles.sql` as the owner. The workflow uses `${MIGRATION_DATABASE_URL:-$DIRECT_URL}`
  — if the secret is absent it gracefully falls back to `DIRECT_URL`, so set the
  secret to get the privileged-owner behavior.

> **Supabase + IPv4 caveat.** The direct `db.<ref>.supabase.co` host is
> **IPv6-only**. On IPv4-only / serverless networks use the Supabase
> **connection pooler (Supavisor)** URL
> (`...pooler.supabase.com:6543?pgbouncer=true&sslmode=require`) for
> `DATABASE_URL`. `MIGRATION_DATABASE_URL` should point at a **direct
> (non-pooler), privileged** host so `prisma migrate deploy` can run DDL — see
> [docs/DEPLOYMENT.md](DEPLOYMENT.md) and `.env.example`.

---

## Step 4 — Verify (issue AC4 & AC5)

### 4a. Role is least-privilege (issue AC4)

Run on the live DB:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';
```

**Expected:**

```
 rolname  | rolsuper | rolbypassrls
----------+----------+--------------
 app_user | f        | f
```

`rolsuper = f` and `rolbypassrls = f` confirm the runtime role cannot bypass RLS.
(Optionally repeat for `control_plane_user` — also expect `f | f`.)

### 4b. Cross-tenant isolation, end-to-end (issue AC5)

Connect to prod **as `app_user`** (the runtime DSN) and confirm a query scoped to
one tenant cannot see another tenant's rows. The runtime sets `app.tenant_id` per
request via `@lms/db.withTenant()` (`SELECT set_config('app.tenant_id', $1,
true)`, transaction-local); this snippet reproduces that GUC manually.

Pick any tenant-scoped table — e.g. `enrollment` (it is in `rls.sql`'s
`tenant_tables` loop and carries `tenant_id`). Substitute two real tenant UUIDs:

```sql
-- Connected as app_user (runtime DSN), tenant A's context:
BEGIN;
SELECT set_config('app.tenant_id', '<tenant-A-uuid>', true);

-- Rows for tenant A are visible:
SELECT count(*) FROM enrollment;                      -- > 0 (tenant A's rows)

-- Tenant B's rows are NOT visible under tenant A's GUC — must be ZERO:
SELECT count(*) FROM enrollment WHERE tenant_id = '<tenant-B-uuid>';   -- expect 0
COMMIT;
```

**Pass criteria:** the final count is **0** — the `tenant_isolation` policy
filters tenant B's rows out even though they exist, because `app_user` cannot
bypass RLS. If the second query returns a non-zero count, isolation is **not**
enforced — recheck that runtime really connects as `app_user` (Step 4a) and that
`FORCE ROW LEVEL SECURITY` / the policy are present (`database/policies/rls.sql`).

> **Sanity check (negative control):** repeating the same query as the
> owner/`postgres` (or any `BYPASSRLS`) role *will* return tenant B's rows —
> that is exactly why runtime must never use that DSN.

---

## Step 5 — Run migrations / seed as the migrator

With `MIGRATION_DATABASE_URL` set, the `with-migration-dsn.mjs` wrapper
(`packages/db/scripts/with-migration-dsn.mjs`) routes `db:migrate` and `db:seed`
to the privileged DSN (it sets both `DATABASE_URL` and `DIRECT_URL` :=
`MIGRATION_DATABASE_URL` for that command only, falling back to the existing
`DATABASE_URL` when `MIGRATION_DATABASE_URL` is unset).

**PowerShell:**

```powershell
$env:MIGRATION_DATABASE_URL = "postgresql://postgres.<ref>:<owner-secret>@<direct-host>:5432/postgres?sslmode=require"
pnpm db:migrate
pnpm db:seed
```

**bash:**

```bash
export MIGRATION_DATABASE_URL="postgresql://postgres.<ref>:<owner-secret>@<direct-host>:5432/postgres?sslmode=require"
pnpm db:migrate
pnpm db:seed
```

- **Runtime services must NOT have `MIGRATION_DATABASE_URL` set** so they stay on
  the `app_user` `DATABASE_URL`. Only the migrate/seed tooling (and the
  `db-migrate.yml` workflow) consumes the privileged DSN.
- If `MIGRATION_DATABASE_URL` is unset, `db:migrate`/`db:seed` fall back to
  `DATABASE_URL` (the `app_user` role), which **lacks DDL/owner rights** — so
  always set the migrator DSN when running migrations/seed against a real deploy.

---

## Cross-references

- **[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md)** — the runtime
  app-role / RLS-enforcement decision (extended to the three-role model by
  #290 + #291).
- **[docs/MULTI_TENANCY.md](MULTI_TENANCY.md)** — the three-role table, the
  `app.tenant_id` GUC, and the defense-in-depth model.
- **[docs/DEPLOYMENT.md](DEPLOYMENT.md)** — prod env / Secrets, the Supabase
  opt-in, and the IPv4 / pooler caveat.
- **[SETUP.md](../SETUP.md)** §5 — local DB setup and the roles model.
- **[`database/roles.sql`](../database/roles.sql)** — the authoritative grants.

_Refs #290._
