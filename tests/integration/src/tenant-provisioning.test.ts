import { randomUUID } from "node:crypto";

import { createPrismaStore } from "@lms/service-tenant/dist/store.prisma.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminPool, appPoolUrl, dbAvailable, ensureSchemaAndRole, type PgPool } from "./helpers/db.js";

/**
 * DB-backed coverage for the tenant control plane's transactional outbox under
 * RLS. The tenant service is the FIRST writer of `event_outbox`, and that table
 * is in the FORCE ROW LEVEL SECURITY loop with `WITH CHECK (tenant_id =
 * current_tenant_id())`. Provisioning runs via the non-tenant-scoped
 * `controlPlane()` client, so without setting the GUC the outbox INSERT would be
 * rejected (current_tenant_id() = NULL) and the whole transaction would abort.
 *
 * This exercises the REAL prisma store (`createPrismaStore`) and proves the
 * set_config('app.tenant_id', <new tenant id>, true) fix lets the `tenant` row
 * and its `tenant.provisioned` outbox row land atomically.
 *
 * Crucially, `controlPlane()` is pointed at the NON-superuser app role here (via
 * CONTROL_PLANE_DATABASE_URL): a superuser would silently BYPASS RLS and the
 * test would prove nothing. Skipped when no DATABASE_URL is configured.
 */
describe.skipIf(!dbAvailable)("Tenant provisioning: outbox write under RLS", () => {
  let admin: PgPool;
  let createdTenantId: string | undefined;
  const savedControlPlaneUrl = process.env.CONTROL_PLANE_DATABASE_URL;

  beforeAll(async () => {
    await ensureSchemaAndRole();
    admin = adminPool();
    // Force controlPlane() to connect as the non-superuser, NOBYPASSRLS app
    // role so FORCE ROW LEVEL SECURITY genuinely applies to the outbox INSERT.
    process.env.CONTROL_PLANE_DATABASE_URL = appPoolUrl();
  });

  afterAll(async () => {
    if (admin) {
      if (createdTenantId) {
        // tenant ON DELETE CASCADE cleans up the event_outbox row too.
        await admin.query("DELETE FROM tenant WHERE id = $1", [createdTenantId]);
      }
      await admin.end();
    }
    if (savedControlPlaneUrl === undefined) {
      delete process.env.CONTROL_PLANE_DATABASE_URL;
    } else {
      process.env.CONTROL_PLANE_DATABASE_URL = savedControlPlaneUrl;
    }
  });

  it("provisions a pool tenant and writes its outbox row atomically under RLS", async () => {
    const store = createPrismaStore();
    const slug = `tp-${randomUUID()}`;

    const result = await store.provisionTenant({ slug, name: "Provisioning Test U" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected provisioning to succeed, got ${result.reason}`);
    createdTenantId = result.tenant.id;

    // (a) the control-plane tenant row landed as an active pool tenant.
    const tenantRows = await admin.query<{ tier: string; status: string }>(
      "SELECT tier, status FROM tenant WHERE id = $1",
      [result.tenant.id],
    );
    expect(tenantRows.rowCount).toBe(1);
    expect(tenantRows.rows[0]!.tier).toBe("pool");
    expect(tenantRows.rows[0]!.status).toBe("active");

    // (b) the RLS-scoped outbox row for THIS tenant landed in the same tx — the
    // proof that the set_config GUC fix admits the WITH CHECK insert.
    const outboxRows = await admin.query<{ type: string; tenant_id: string }>(
      "SELECT type, tenant_id FROM event_outbox WHERE tenant_id = $1",
      [result.tenant.id],
    );
    expect(outboxRows.rowCount).toBe(1);
    expect(outboxRows.rows[0]!.type).toBe("tenant.provisioned");
    expect(outboxRows.rows[0]!.tenant_id).toBe(result.tenant.id);
  });
});
