import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminPool,
  appPool,
  createTenant,
  dbAvailable,
  ensureSchemaAndRole,
  withGuc,
  type PgPool,
} from "./helpers/db.js";

/**
 * Proves Postgres row-level security isolates tenants on the shared (pool)
 * database. Runs as a NON-superuser role so FORCE ROW LEVEL SECURITY actually
 * applies (a superuser would silently bypass every policy). Skipped when no
 * DATABASE_URL is configured (e.g. local runs without the docker-compose stack).
 */
describe.skipIf(!dbAvailable)("RLS tenant isolation", () => {
  let admin: PgPool;
  let app: PgPool;
  let tenantA: string;
  let tenantB: string;
  let rowId: string;
  const rowEmail = `alice-${randomUUID()}@isolation.test`;

  beforeAll(async () => {
    await ensureSchemaAndRole();
    admin = adminPool();
    app = appPool();

    tenantA = await createTenant(admin, `rls-a-${randomUUID()}`, "Tenant A");
    tenantB = await createTenant(admin, `rls-b-${randomUUID()}`, "Tenant B");

    // Seed one app_user for tenant A, written through the app role under RLS.
    rowId = await withGuc(app, tenantA, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, email, display_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantA, rowEmail, "Alice"],
      );
      return r.rows[0]!.id;
    });
  });

  afterAll(async () => {
    if (admin) {
      await admin.query("DELETE FROM tenant WHERE id = ANY($1::uuid[])", [
        [tenantA, tenantB],
      ]);
      await admin.end();
    }
    if (app) await app.end();
  });

  it("lets tenant A read its own row", async () => {
    const count = await withGuc(app, tenantA, async (c) =>
      (await c.query("SELECT id FROM app_user WHERE id = $1", [rowId])).rowCount,
    );
    expect(count).toBe(1);
  });

  it("hides tenant A's row from tenant B (SELECT)", async () => {
    const count = await withGuc(app, tenantB, async (c) =>
      (await c.query("SELECT id FROM app_user WHERE id = $1", [rowId])).rowCount,
    );
    expect(count).toBe(0);
  });

  it("blocks tenant B from updating tenant A's row", async () => {
    const affected = await withGuc(app, tenantB, async (c) =>
      (
        await c.query(
          "UPDATE app_user SET display_name = 'hacked' WHERE id = $1",
          [rowId],
        )
      ).rowCount,
    );
    expect(affected).toBe(0);
  });

  it("blocks tenant B from deleting tenant A's row", async () => {
    const affected = await withGuc(app, tenantB, async (c) =>
      (await c.query("DELETE FROM app_user WHERE id = $1", [rowId])).rowCount,
    );
    expect(affected).toBe(0);
  });

  it("rejects an INSERT stamped with another tenant's id (WITH CHECK)", async () => {
    await expect(
      withGuc(app, tenantB, async (c) =>
        c.query(
          `INSERT INTO app_user (tenant_id, email, display_name)
           VALUES ($1, $2, $3)`,
          [tenantA, `evil-${randomUUID()}@isolation.test`, "Mallory"],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("returns nothing when no tenant context is set", async () => {
    const count = await withGuc(app, null, async (c) =>
      (await c.query("SELECT id FROM app_user WHERE id = $1", [rowId])).rowCount,
    );
    expect(count).toBe(0);
  });

  it("confirms the row really exists (superuser bypasses RLS)", async () => {
    // Sanity check + documents WHY the tests must use a non-superuser role:
    // the admin/superuser connection sees the row regardless of RLS.
    const count = (
      await admin.query("SELECT id FROM app_user WHERE id = $1", [rowId])
    ).rowCount;
    expect(count).toBe(1);
  });
});
