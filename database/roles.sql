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

-- NOTE: app_user intentionally gets CRUD on the control-plane `tenant` table
-- (which is deliberately NOT in rls.sql's `tenant_tables` loop) so controlPlane()
-- reads and the outbox relay's tenant enumeration work. This does NOT weaken
-- tenant isolation: every tenant-OWNED table carries tenant_id and is protected
-- by the FORCE'd `tenant_isolation` policy, to which app_user (NOBYPASSRLS,
-- non-owner) is fully subject.
