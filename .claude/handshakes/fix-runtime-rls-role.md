# Handshake — fix/runtime-rls-role

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #286 — runtime DATABASE_URL must use a NOSUPERUSER/NOBYPASSRLS app role so RLS is enforced  ·  https://github.com/AkshatArora7/lms-saas/issues/286
- **Type:** fix
- **Branch:** fix/runtime-rls-role  (off fresh `main` @ cd3de16)
- **Requested by / date:** @AkshatArora7 · 2026-06-21
- **One-line goal:** Issue #286: runtime DATABASE_URL must use a NOSUPERUSER/NOBYPASSRLS app role so RLS is enforced

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] The runtime connection role used by every service's `DATABASE_URL` (local compose AND real/Supabase deploys) is `NOSUPERUSER NOBYPASSRLS` (a dedicated least-privilege app role), distinct from the migration/owner role.
- [ ] `docker-compose.yml` (and any deploy/env config) provisions/uses that app role for service runtime, while migrations/seed may use a privileged role separately.
- [ ] An automated test proves enforcement against the RUNTIME role: tenant A seeds data, a request with tenant B's context returns ZERO of tenant A's rows (curl through a service AND/or a DB-level test using the runtime role) — i.e. the demo-stack `2222...` sees `1111...` data finding can no longer reproduce.
- [ ] Document the role model (owner/migrator vs app/runtime) in `SETUP.md` / `docs/MULTI_TENANCY.md` and reconcile with the existing notes.
- [ ] Verify real (non-demo) deploy role privileges and record the finding.

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☑ done | Issue #286 has AC; claimed + board In Progress |
| Architecture | architect | ☑ done | §4 below + ADR-0026 (`docs/ADR-0026-runtime-app-role-rls-enforcement.md`) |
| UX design | ux-designer | ☐ n/a | |
| Data & RLS | schema-agent | ☑ done | §4 Data shapes below — `database/roles.sql` authored, pglast OK, FORCE RLS confirmed |
| Backend | service-builder | ☐ todo | |
| Frontend | frontend-dev | ☐ n/a | |
| QA / tests | qa-agent | ☐ todo | |
| Security & DoD | security-agent | ☐ todo | |
| Docs | docs-agent | ☐ todo | |

## 4. Decisions & contracts  (append; never rewrite history)

### Architecture (architect) — two-role DB model (ADR-0026)

**ADR:** `docs/ADR-0026-runtime-app-role-rls-enforcement.md`.

#### Ground truth (verified in source)
- `x-common-env` anchor: `DATABASE_URL: ${DATABASE_URL:-postgresql://lms:lms@postgres:5432/lms}` (`docker-compose.yml:47`, anchor 41-53). **All** services AND the `seed` service inherit it via `<<: *common-env` (`docker-compose.yml:113`).
- In-compose Postgres role `lms` = `POSTGRES_USER` (`docker-compose.yml:70-72`) → **SUPERUSER + table owner** → bypasses RLS regardless of `FORCE`. This is the bug.
- Schema + RLS auto-applied on first boot via initdb mounts `01-schema.sql`, `02-rls.sql` (`docker-compose.yml:76-77`), run as `lms`.
- `seed` runs `pnpm db:seed:demo` → `tsx prisma/seed.demo.ts` (`packages/db/seed.Dockerfile:34`, `packages/db/package.json:16`); writes the control-plane `tenant` row + one tenant's dataset and sets the GUC as defence-in-depth (`packages/db/prisma/seed.demo.ts:14-19`). **Needs the privileged role.**
- `withTenant` = Prisma `$transaction` + `SELECT set_config('app.tenant_id', $1, true)` (`packages/db/src/index.ts:59-65`). `current_tenant_id()` reads `current_setting('app.tenant_id', true)` + `NULLIF` → unset ⇒ NULL ⇒ matches no rows (`database/schema.sql:21-24`).
- `FORCE ROW LEVEL SECURITY` confirmed on every tenant table + `role_permission` (`database/policies/rls.sql:43,65`).
- **Reference recipe already exists:** `tests/integration/src/helpers/db.ts:20-21,86-104` creates `lms_rls_app`/`lms_rls_app_pw` `NOSUPERUSER NOBYPASSRLS` + grants CRUD. Mirror it.
- `apps/web`/`apps/admin` do NOT use `DATABASE_URL` (HTTP to services — `docker-compose.yml:604-619,665-673`) → **no app changes**; only backend services + seed.
- Only `database/schema.sql` + `database/policies/rls.sql` exist today — `database/roles.sql` is net-new.

#### 1. Role model (two roles)
- **Migration/owner role** = existing `lms` (superuser, table owner). Used ONLY by initdb (schema+rls+roles) and the `seed` service. Never by a runtime service.
- **Runtime app role** = `app_user` — `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, non-owner, CRUD-only. Used by every runtime service's `DATABASE_URL`. Under `FORCE RLS` it is fully subject to `tenant_isolation`.

#### 2. `database/roles.sql` (schema-agent owns — exact statements, mirror test helper)
```sql
-- database/roles.sql — run AFTER schema.sql + rls.sql, as the owner/superuser.
-- Idempotent. Credentials are LOCAL/COMPOSE ONLY — real deploys inject their own.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
```
`app_user` deliberately gets CRUD on the control-plane `tenant` table (NOT in `rls.sql`'s `tenant_tables`) — required for `controlPlane()` reads and the outbox relay's tenant enumeration (`docs/MULTI_TENANCY.md:44-55`). Do NOT make `app_user` an owner; do NOT grant BYPASSRLS/superuser. Validate with pglast.

#### 3. Where it's created & wired (service-builder / infra owns compose)
- Add mount to `postgres`: `./database/roles.sql:/docker-entrypoint-initdb.d/03-roles.sql:ro` (runs after 01/02, as `lms`).
- Split the connection strings:
  - `x-common-env` (all runtime services) → `DATABASE_URL: ${DATABASE_URL:-postgresql://app_user:app_user@postgres:5432/lms}` (flows into `DIRECT_URL`/`CONTROL_PLANE_DATABASE_URL` defaults at 48-49 — app_user correct for both).
  - `seed.environment` (after `<<: *common-env`, line 112-113) → `DATABASE_URL: ${MIGRATION_DATABASE_URL:-postgresql://lms:lms@postgres:5432/lms}`.
- Net: seed connects as owner `lms` and succeeds; every service connects as `app_user` (RLS enforced); demo login + screens keep working WITH enforcement.
- **Real/Supabase:** operator sets `.env` `DATABASE_URL` = least-priv role URL, `MIGRATION_DATABASE_URL` = privileged role URL.

#### 4. Defence-in-depth (GUC for non-owner)
`withTenant` keeps setting `app.tenant_id`; under `app_user` (NOBYPASSRLS, non-owner, FORCE RLS) the engine now enforces it. Setting the custom placeholder GUC `app.*` needs **no privilege** and is transaction-scoped — confirmed safe for a non-owner role.

#### 5. Real/prod (Supabase) verification (AC 5)
Run against the live deploy DB as the runtime role and record the result:
```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname = current_user;
```
PASS = `rolsuper=f AND rolbypassrls=f`. Real creds are (correctly) not in the repo → deliverable is the verification query + provisioning docs; qa-agent runs it against the live DB, security-agent gates, finding recorded here.

#### 6. Test / enforcement proof (key AC 3)
- **DB-level half already exists** in `tests/integration` via the `lms_rls_app` NOSUPERUSER role (`appPool()`, `withGuc()` in `tests/integration/src/helpers/db.ts`). Reuse — don't duplicate. Confirm/add: seed tenant A; via `appPool()` set `app.tenant_id` to tenant B (and `null`); assert ZERO of A's rows visible.
- **NEW (stack/service-level):** bring up compose (services on `app_user`), seed `1111…`, `curl` a read endpoint with `x-tenant-id: 2222…`, assert NONE of `1111…`'s rows — the original repro is dead.
- **Overlap w/ #280:** #280 = analytics `/reports/org-units` live-DB RLS test (5 rollup tables). #286 owns the generic runtime-role enforcement + service-level curl proof. Keep distinct; share the `appPool`/`withGuc` helpers.

#### 7. Build sequence (riskiest flagged)
1. **schema-agent** — author `database/roles.sql` (above) + pglast validate; confirm clean apply after schema+rls.
2. **service-builder / infra** — wire `docker-compose.yml`: add `03-roles.sql` mount; split `DATABASE_URL`→`app_user`; seed→`MIGRATION_DATABASE_URL`=`lms`. **⚠ RISKIEST STEP** — rewiring creds without breaking the seed one-shot or service startup (too-narrow grant → service 500; wrong seed creds → seed fails and identity/web/admin never start). Verify `docker compose up` end-to-end + demo login.
3. **qa-agent** — prove enforcement: DB-level (reuse appPool) + live curl `2222…` vs `1111…`; run the `pg_roles` check; full stack green.
4. **security-agent** — isolation gate (core mandate): no runtime path on a bypassing role, GUC scoping correct, DoD.
5. **docs-agent** — update `SETUP.md:146-148` + `docs/MULTI_TENANCY.md:26`: owner/migrator vs app/runtime role model; Supabase provisioning + verification query.

#### 8. Risks / rollback
- **Too-narrow grants** → service 500 on first write; mitigated by `ALL TABLES`/`ALL SEQUENCES` + `ALTER DEFAULT PRIVILEGES`. Verify fast: hit one write endpoint per domain post-up.
- **Ordering** → `app_user` must exist before services connect; guaranteed by initdb order (03 after 01/02) + `depends_on: postgres service_healthy`.
- **initdb only runs on empty volume** → existing `lms_pgdata` / Supabase won't auto-create `app_user`; doc the explicit `roles.sql` apply.
- **Rollback:** revert the `DATABASE_URL` split (services back to `lms`) restores prior behaviour; `roles.sql` is additive/harmless if left.

### Other roles (downstream — placeholders)
- **Data shapes (schema-agent):** DONE — `database/roles.sql` authored per §4.2.
  - **Object:** ROLE `app_user` (not a table). `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, password `app_user` (DEV/COMPOSE ONLY — prod injects strong pw). Created idempotently via `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user')`.
  - **Privilege set (mirrors `tests/integration/src/helpers/db.ts:86-104` + ADR-0026 §4.2):** `GRANT USAGE ON SCHEMA public`; `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public`; `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public`; `ALTER DEFAULT PRIVILEGES FOR ROLE lms IN SCHEMA public GRANT ...ON TABLES/SEQUENCES` (future tables auto-granted). NO DDL/owner/BYPASSRLS/superuser grants. Owner role confirmed = `lms` (docker-compose.yml:70).
  - **RLS decision:** N/A per-table (this is a role, not a table). **FORCE ROW LEVEL SECURITY confirmed present on every tenant table (`rls.sql:43`) and on `role_permission` (`rls.sql:65`) — no missing FORCE, no scope creep needed.** Because `app_user` is non-owner + NOBYPASSRLS, it is fully subject to `tenant_isolation`.
  - **pglast:** `database/roles.sql`, `database/schema.sql`, `database/policies/rls.sql` all parse OK (CI step replicated, `.github/workflows/ci.yml:46-55`).
  - **Apply ordering:** mounted in compose as `/docker-entrypoint-initdb.d/03-roles.sql` (after 01-schema, 02-rls), runs as owner `lms` (docker-compose.yml postgres volumes). No `pnpm db:apply`/scripts exist; the only non-compose path is the manual `psql` block in `SETUP.md:124-128` → left to **docs-agent** to add `psql "$DIRECT_URL" -f database/roles.sql`.
  - **Boundary left for service-builder:** per-service `DATABASE_URL` split is NOT done here — `x-common-env` still defaults to `lms`. service-builder switches runtime services → `postgresql://app_user:app_user@postgres:5432/lms` and points `seed` → `MIGRATION_DATABASE_URL` (`lms`) per §4.3. I only added the `03-roles.sql` initdb mount.

## 5. Verification  (real output only — paste, don't summarize away errors)
- **QA (qa-agent):** typecheck / lint / test / build counts; per-AC test mapping; root-cause notes for any failure.
- **Security & DoD (security-agent):** isolation/authz/secrets findings; APPROVE / CHANGES REQUESTED.

## 6. Open questions / blockers
- Real/Supabase runtime role privileges are NOT determinable from the repo (creds not committed — correct). Resolved as: ship the verification query (§4.5) + docs; qa/security run it against the live DB and record the finding (AC 5).

## 7. Handshake log  (append-only; one line per hand-off)
- 2026-06-21 12:14 · orchestrator · claimed #286, branch fix/runtime-rls-role off main@cd3de16, board → In Progress, handshake seeded · **next owner → architect**
- 2026-06-21 12:20 · architect · recorded two-role design + build sequence (§4), authored ADR-0026 · **next owner → schema-agent** (author `database/roles.sql` + pglast validate)
- 2026-06-21 12:21 · schema-agent · authored `database/roles.sql` (idempotent app_user, NOSUPERUSER/NOBYPASSRLS, CRUD + future ALTER DEFAULT PRIVILEGES); added `03-roles.sql` initdb mount to docker-compose.yml; FORCE RLS confirmed on all tenant tables + role_permission; pglast OK on roles/schema/rls · **next owner → service-builder** (split `DATABASE_URL` → app_user for runtime services, seed → MIGRATION_DATABASE_URL=lms per §4.3)
