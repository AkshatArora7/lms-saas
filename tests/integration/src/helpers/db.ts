import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import pg from "pg";

const { Pool } = pg;

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

/**
 * A dedicated NON-superuser login role used by the isolation tests.
 *
 * This matters: the database owner created by the Postgres image (and the `lms`
 * role used in CI) is a SUPERUSER, and superusers BYPASS row-level security even
 * when `FORCE ROW LEVEL SECURITY` is set. To actually prove tenant isolation we
 * must connect as a non-superuser, non-BYPASSRLS role — exactly what the app
 * uses in production. These are throwaway local/CI test credentials, not secrets.
 */
export const APP_ROLE = "lms_rls_app";
const APP_PASSWORD = "lms_rls_app_pw";

/**
 * A dedicated NON-superuser login role mirroring the production `control_plane_user`
 * (database/roles.sql): SELECT on every table plus a small, explicit control-plane
 * WRITE set — I/U/D on `tenant`, `tenant_admin_delegation`, `tenant_silo_migration`
 * and INSERT on the tenant-scoped `event_outbox` (the transactional-outbox row
 * provisionTenant writes inside the same controlPlane() transaction). It is
 * NOSUPERUSER NOBYPASSRLS so that in-tx outbox INSERT stays fully RLS-subject —
 * exactly the grant this test must guard. Throwaway local/CI credentials.
 */
export const CONTROL_PLANE_ROLE = "lms_rls_control_plane";
const CONTROL_PLANE_PASSWORD = "lms_rls_control_plane_pw";

const ADVISORY_LOCK_KEY = 727274;

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  return url && url.length > 0 ? url : undefined;
}

/** Integration tests only run when a Postgres connection is configured. */
export const dbAvailable = databaseUrl() !== undefined;

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function adminPool(): PgPool {
  return new Pool({ connectionString: databaseUrl(), max: 4 });
}

/** Same host/database as DATABASE_URL but connecting as the non-superuser role. */
export function appPoolUrl(): string {
  const url = new URL(databaseUrl()!);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  return url.toString();
}

export function appPool(): PgPool {
  return new Pool({ connectionString: appPoolUrl(), max: 4 });
}

/**
 * Same host/database as DATABASE_URL but connecting as the control-plane write
 * role (`lms_rls_control_plane`). Used to point `controlPlane()` at a principal
 * with the real production control_plane_user grant shape.
 */
export function controlPlanePoolUrl(): string {
  const url = new URL(databaseUrl()!);
  url.username = CONTROL_PLANE_ROLE;
  url.password = CONTROL_PLANE_PASSWORD;
  return url.toString();
}

/**
 * Make sure the schema + RLS policies are applied and the non-superuser test
 * roles exist: the app role (`lms_rls_app`, full CRUD) and the control-plane
 * write role (`lms_rls_control_plane`, SELECT + the explicit control-plane write
 * set). Idempotent and safe to call from multiple test files concurrently
 * (serialised with a Postgres advisory lock).
 */
export async function ensureSchemaAndRole(): Promise<void> {
  const root = findRepoRoot();
  const admin = adminPool();
  const client = await admin.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

    const reg = await client.query<{ t: string | null }>(
      "SELECT to_regclass('public.app_user') AS t",
    );
    if (reg.rows[0]?.t === null) {
      const schema = readFileSync(resolve(root, "database", "schema.sql"), "utf8");
      await client.query(schema);
    }

    const rls = readFileSync(
      resolve(root, "database", "policies", "rls.sql"),
      "utf8",
    );
    await client.query(rls);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
    );

    // Control-plane write role, mirroring production `control_plane_user`
    // (database/roles.sql): SELECT everywhere + a small explicit write set
    // (I/U/D on the 3 control-plane tables + INSERT on event_outbox), NOBYPASSRLS
    // so the in-tx outbox INSERT stays RLS-subject.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${CONTROL_PLANE_ROLE}') THEN
          CREATE ROLE ${CONTROL_PLANE_ROLE} LOGIN PASSWORD '${CONTROL_PLANE_PASSWORD}'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${CONTROL_PLANE_ROLE}`);
    await client.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${CONTROL_PLANE_ROLE}`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${CONTROL_PLANE_ROLE}`,
    );
    await client.query(
      `GRANT INSERT, UPDATE, DELETE ON tenant, tenant_admin_delegation, tenant_silo_migration TO ${CONTROL_PLANE_ROLE}`,
    );
    await client.query(
      `GRANT INSERT ON event_outbox TO ${CONTROL_PLANE_ROLE}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT ON TABLES TO ${CONTROL_PLANE_ROLE}`,
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    client.release();
    await admin.end();
  }
}

/**
 * Run `fn` inside a transaction with the request-scoped `app.tenant_id` GUC set,
 * mirroring `@lms/db.withTenant()` so RLS policies apply exactly as in the app.
 * Pass `null` to simulate a request with no tenant context.
 */
export async function withGuc<T>(
  pool: PgPool,
  tenantId: string | null,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      tenantId ?? "",
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Insert a control-plane tenant (not under RLS) and return its id. */
export async function createTenant(
  admin: PgPool,
  slug: string,
  name: string,
): Promise<string> {
  const res = await admin.query<{ id: string }>(
    "INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id",
    [slug, name],
  );
  return res.rows[0]!.id;
}
