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
-- Three-role model (Issue #290 / #291):
--   * `lms`                — migration/owner role. Runs schema.sql, rls.sql,
--                            roles.sql and the demo seed. Superuser + table
--                            owner, RLS-exempt. Reached via MIGRATION_DATABASE_URL
--                            for DDL/seeds ONLY — NEVER a runtime role.
--   * `control_plane_user` — control-plane operations role, reached via
--                            CONTROL_PLANE_DATABASE_URL (the principal behind
--                            @lms/db controlPlane()). NOSUPERUSER NOBYPASSRLS,
--                            non-owner. SELECT on every table + a small, explicit
--                            WRITE set: INSERT/UPDATE/DELETE on the control-plane
--                            tables (tenant, tenant_admin_delegation,
--                            tenant_silo_migration) PLUS INSERT on event_outbox
--                            (provisionTenant writes the transactional outbox in
--                            the same control-plane transaction). Because it is
--                            NOBYPASSRLS, that in-tx event_outbox INSERT stays
--                            fully subject to the FORCE'd `tenant_isolation`
--                            policy under the request's `app.tenant_id` GUC.
--   * `app_user`           — per-request runtime role used by every service,
--                            reached via DATABASE_URL. NOSUPERUSER NOBYPASSRLS,
--                            non-owner. Full CRUD on every tenant-scoped table
--                            (incl. event_outbox), but SELECT-ONLY on all five
--                            control-plane tables. Under FORCE RLS it is fully
--                            subject to the `tenant_isolation` policy.
--
-- ORDERING: run AFTER schema.sql (01) and rls.sql (02), AS the owner/superuser
-- (`lms`). In compose this is mounted as
-- `/docker-entrypoint-initdb.d/03-roles.sql`. This file is idempotent and safe
-- to re-run against an existing database.
--
-- CREDENTIALS: the passwords below ('app_user' / 'control_plane_user') are
-- LOCAL / COMPOSE DEV defaults ONLY so the dev DSNs work out of the box
-- (postgresql://app_user:app_user@postgres/lms and
-- postgresql://control_plane_user:control_plane_user@postgres/lms). PRODUCTION /
-- Supabase deploys MUST inject strong, unique passwords for BOTH roles (e.g. via
-- APP_DB_PASSWORD / CONTROL_PLANE_DB_PASSWORD / ALTER ROLE ... PASSWORD ...) and
-- MUST NOT ship these dev credentials.
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

-- ============================================================================
-- Control-plane operations role (Issue #291) — least privilege, RLS-subject.
-- ============================================================================
-- `control_plane_user` is the principal behind @lms/db controlPlane() (reached
-- via CONTROL_PLANE_DATABASE_URL). It performs control-plane reads broadly and
-- a small, explicit set of control-plane WRITES. It is NOSUPERUSER NOBYPASSRLS
-- and a NON-OWNER, so even its writes to the tenant-scoped `event_outbox` stay
-- fully subject to the FORCE'd `tenant_isolation` policy.
--
-- CREDENTIALS: the password below ('control_plane_user') is a LOCAL / COMPOSE
-- DEV default ONLY so the dev CONTROL_PLANE_DATABASE_URL
-- (postgresql://control_plane_user:control_plane_user@postgres/lms) works out of
-- the box. PRODUCTION / Supabase deploys MUST inject a strong, unique password
-- (e.g. via CONTROL_PLANE_DB_PASSWORD / ALTER ROLE control_plane_user
-- PASSWORD ...) and MUST NOT ship this dev credential.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'control_plane_user') THEN
    CREATE ROLE control_plane_user LOGIN PASSWORD 'control_plane_user'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Schema access (no DDL/owner rights).
GRANT USAGE ON SCHEMA public TO control_plane_user;

-- Control-plane operations READ broadly (e.g. relay enumerating tenants, billing
-- reading the global plan catalog, branding/domain lookups). SELECT-everywhere
-- is the read envelope; writes are the explicit named set below.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO control_plane_user;

-- Sequence usage (defensive — current schema uses uuid PKs).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO control_plane_user;

-- Explicit control-plane WRITE set. INSERT/UPDATE/DELETE on the three
-- control-plane tables, PLUS INSERT on the tenant-scoped `event_outbox`:
-- provisionTenant (services/tenant/src/store.prisma.ts) writes the transactional
-- outbox row inside the SAME controlPlane() transaction, under the
-- `set_config('app.tenant_id', …, true)` GUC. Because control_plane_user is
-- NOBYPASSRLS, that outbox INSERT remains enforced by the outbox WITH CHECK.
-- Guard each with to_regclass so a partial DB can't error.
DO $$
DECLARE
  t text;
  control_plane_write_tables text[] :=
    ARRAY['tenant','tenant_admin_delegation','tenant_silo_migration'];
BEGIN
  FOREACH t IN ARRAY control_plane_write_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT INSERT, UPDATE, DELETE ON %I TO control_plane_user;', t);
    END IF;
  END LOOP;
  -- Transactional-outbox write inside provisionTenant's control-plane tx.
  IF to_regclass('public.event_outbox') IS NOT NULL THEN
    EXECUTE 'GRANT INSERT ON event_outbox TO control_plane_user;';
  END IF;
END $$;

-- FUTURE objects created by the owner (`lms`) auto-grant control_plane_user
-- SELECT only — its write set stays the fixed named list above (NO blanket
-- future I/U/D), preserving least privilege as new tables are added.
ALTER DEFAULT PRIVILEGES FOR ROLE lms IN SCHEMA public
  GRANT SELECT ON TABLES TO control_plane_user;
ALTER DEFAULT PRIVILEGES FOR ROLE lms IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO control_plane_user;

-- ----------------------------------------------------------------------------
-- Least-privilege hardening for CONTROL-PLANE tables (Issue #291).
-- ----------------------------------------------------------------------------
-- The blanket CRUD grant above intentionally covers EVERY table so no service
-- 500s on a missing privilege and future tenant-scoped tables keep CRUD by
-- default. We then REVOKE write privileges from app_user on ALL FIVE
-- control-plane tables, leaving SELECT intact. The control-plane tables are
-- exactly those NOT in rls.sql's `tenant_tables` loop (and not the join-isolated
-- `role_permission`): tenant, plan, permission, tenant_admin_delegation,
-- tenant_silo_migration.
--
-- app_user is now SELECT-ONLY on every control-plane table:
--   * tenant                  — registry; app_user-path reads only (writes now
--                               flow via control_plane_user / controlPlane()).
--   * plan                    — global billing catalog; read to resolve a plan.
--   * permission              — global permission catalog; read for authz.
--   * tenant_admin_delegation — delegation registry; writes via controlPlane().
--   * tenant_silo_migration   — pool->silo saga state; writes via controlPlane().
-- Every control-plane WRITE has moved to the dedicated `control_plane_user`
-- role above (reached via CONTROL_PLANE_DATABASE_URL). app_user RETAINS full
-- CRUD on every tenant-scoped table (incl. event_outbox — normal runtime outbox
-- writes via withTenant are unaffected) and USAGE/SELECT on sequences. This
-- finally satisfies Issue #291 AC#1's literal text without 500ing the stack.
--
-- This does NOT weaken tenant isolation: every tenant-OWNED table carries
-- tenant_id and is protected by the FORCE'd `tenant_isolation` policy, to which
-- BOTH app_user and control_plane_user (NOBYPASSRLS, non-owner) are fully
-- subject.
DO $$
DECLARE
  t text;
  select_only_control_plane text[] := ARRAY[
    'tenant','plan','permission','tenant_admin_delegation','tenant_silo_migration'
  ];
BEGIN
  FOREACH t IN ARRAY select_only_control_plane LOOP
    -- roles.sql runs AFTER schema.sql, but guard so a partial DB can't error.
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM app_user;', t);
      -- Belt-and-suspenders: ensure SELECT survives (registry/authz/billing reads).
      EXECUTE format('GRANT SELECT ON %I TO app_user;', t);
    END IF;
  END LOOP;
END $$;
