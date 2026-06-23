-- ============================================================================
-- LMS SaaS — Runtime application role (least privilege, RLS-subject)
-- ============================================================================
-- Issue #286 / ADR-0026: every service's runtime DATABASE_URL must connect as a
-- NOSUPERUSER NOBYPASSRLS, NON-OWNER role so that row-level security in
-- `database/policies/rls.sql` is actually ENFORCED. The migration/owner role
-- (`lms`, POSTGRES_USER) is a SUPERUSER + table owner and Postgres exempts it
-- from ALL row-level security even under FORCE ROW LEVEL SECURITY — so it must
-- never be used for runtime traffic.
--
-- Two-role model:
--   * `lms`      — migration/owner role. Runs schema.sql, rls.sql, roles.sql and
--                  the demo seed. Superuser + table owner. NEVER a runtime role.
--   * `app_user` — runtime role used by every service. NOSUPERUSER NOBYPASSRLS,
--                  non-owner, CRUD-only. Under FORCE RLS it is fully subject to
--                  the `tenant_isolation` policy.
--
-- ORDERING: run AFTER schema.sql (01) and rls.sql (02), AS the owner/superuser
-- (`lms`). In compose this is mounted as
-- `/docker-entrypoint-initdb.d/03-roles.sql`. This file is idempotent and safe
-- to re-run against an existing database.
--
-- CREDENTIALS: the password below ('app_user') is a LOCAL / COMPOSE DEV default
-- ONLY so the dev DATABASE_URL (postgresql://app_user:app_user@postgres/lms)
-- works out of the box. PRODUCTION / Supabase deploys MUST inject a strong,
-- unique password (e.g. via APP_DB_PASSWORD / ALTER ROLE app_user PASSWORD ...)
-- and MUST NOT ship this dev credential.
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Schema access (no DDL/owner rights).
GRANT USAGE ON SCHEMA public TO app_user;

-- CRUD on every existing application table. Covers the whole `public` schema so
-- no service 500s on a missing privilege. NO owner/DDL grants — app_user can
-- read/write rows but cannot ALTER/DROP/own tables, and remains subject to RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Sequence usage (defensive — current schema uses uuid PKs, but any future
-- serial/identity column needs this for nextval/currval to succeed).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- FUTURE objects created by the owner (`lms`) are auto-granted to app_user, so
-- newly added tables/sequences from later migrations need no extra grant step.
ALTER DEFAULT PRIVILEGES FOR ROLE lms IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE lms IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ----------------------------------------------------------------------------
-- Least-privilege hardening for CONTROL-PLANE tables (Issue #291).
-- ----------------------------------------------------------------------------
-- The blanket CRUD grant above intentionally covers EVERY table so no service
-- 500s on a missing privilege and future tenant-scoped tables keep CRUD by
-- default. We then REVOKE write privileges from app_user on the control-plane
-- tables that have NO runtime writer, leaving SELECT intact. The control-plane
-- tables are exactly those NOT in rls.sql's `tenant_tables` loop (and not the
-- join-isolated `role_permission`): tenant, plan, permission,
-- tenant_admin_delegation, tenant_silo_migration.
--
-- SELECT-ONLY (no runtime writer — read-only at runtime, seeded by owner `lms`):
--   * plan        — global billing catalog; only READ to resolve a tenant's plan.
--   * permission  — global permission catalog; only READ for authz checks.
-- (SELECT is preserved below, so controlPlane()/authz reads still work.)
--
-- KEPT CRUD (a legitimate runtime path writes these AS app_user via
-- controlPlane(), which in the demo stack SHARES the app_user credential —
-- docker-compose.yml sets CONTROL_PLANE_DATABASE_URL to the app_user DSN, and
-- the tenant-provisioning integration test pins controlPlane() to the
-- non-superuser app_user precisely so the in-transaction outbox INSERT stays
-- RLS-enforced). Revoking writes here WOULD break the running stack:
--   * tenant                 — tenant service INSERTs/UPDATEs tenant rows
--                              (provisioning, parent promotion, status/tier).
--   * tenant_admin_delegation — tenant service INSERTs/UPDATEs delegations.
--   * tenant_silo_migration   — pool->silo promotion saga writes its run state.
-- This does NOT weaken tenant isolation: every tenant-OWNED table carries
-- tenant_id and is protected by the FORCE'd `tenant_isolation` policy, to which
-- app_user (NOBYPASSRLS, non-owner) is fully subject.
--
-- FOLLOW-UP (Issue #291 AC#3): introduce a dedicated, write-capable control-plane
-- DB role (its own CONTROL_PLANE_DATABASE_URL credential) so these three tables
-- can ALSO drop to SELECT-only for app_user without a permission 500 in the
-- demo stack. Deferred to a separate change to keep the running stack green.
DO $$
DECLARE
  t text;
  select_only_control_plane text[] := ARRAY['plan','permission'];
BEGIN
  FOREACH t IN ARRAY select_only_control_plane LOOP
    -- roles.sql runs AFTER schema.sql, but guard so a partial DB can't error.
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM app_user;', t);
      -- Belt-and-suspenders: ensure SELECT survives (authz/billing reads).
      EXECUTE format('GRANT SELECT ON %I TO app_user;', t);
    END IF;
  END LOOP;
END $$;
