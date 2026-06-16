import { randomUUID } from "node:crypto";

import { createPrismaStore as createNotificationStore } from "@lms/service-notification/dist/store.prisma.js";
import {
  createPrismaConsumerInbox,
  createPrismaStore,
} from "@lms/service-relay/dist/store.prisma.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminPool,
  appPool,
  appPoolUrl,
  createTenant,
  dbAvailable,
  ensureSchemaAndRole,
  withGuc,
  type PgPool,
} from "./helpers/db.js";

/**
 * DB-backed proof of the transactional-outbox relay under RLS.
 *
 * The relay's prisma store drains `event_outbox` ENTIRELY inside the per-tenant
 * GUC (FORCE ROW LEVEL SECURITY + NOBYPASSRLS app role), then stamps
 * published_at. Re-running drains nothing. Consumer-side dedupe over
 * `event_inbox` makes redelivery a no-op. We point @lms/db's shared pool at the
 * non-superuser app role (via DATABASE_URL) so RLS genuinely applies — a
 * superuser would silently bypass it and prove nothing. Skipped without a DB.
 */
describe.skipIf(!dbAvailable)("Outbox relay: drain + dedupe under RLS", () => {
  let admin: PgPool;
  let app: PgPool;
  let tenant: string;
  const savedDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await ensureSchemaAndRole();
    admin = adminPool();
    app = appPool();
    tenant = await createTenant(admin, `relay-${randomUUID()}`, "Relay Test U");
    // withTenant() (used by the prisma relay store) builds its pool from
    // DATABASE_URL; route it through the non-superuser app role so RLS applies.
    process.env.DATABASE_URL = appPoolUrl();
  });

  afterAll(async () => {
    if (admin) {
      // tenant ON DELETE CASCADE removes its event_outbox/event_inbox rows.
      await admin.query("DELETE FROM tenant WHERE id = $1", [tenant]);
      await admin.end();
    }
    if (app) await app.end();
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  it("drains an unpublished outbox row once and stamps published_at", async () => {
    // Insert an outbox row for this tenant, under its own RLS GUC.
    const eventId = await withGuc(app, tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO event_outbox (tenant_id, type, payload)
         VALUES ($1, 'enrollment.created', $2::jsonb)
         RETURNING id`,
        [tenant, JSON.stringify({ recipientIds: ["u1"], title: "Enrolled" })],
      );
      return r.rows[0]!.id;
    });

    const store = createPrismaStore({ tier: "pool" });
    const delivered: string[] = [];

    const first = await store.drainTenant(tenant, async (event) => {
      delivered.push(event.id);
    });
    expect(first.published).toBe(1);
    expect(delivered).toEqual([eventId]);

    // published_at got stamped.
    const stamped = await withGuc(app, tenant, async (c) =>
      (
        await c.query(
          "SELECT published_at FROM event_outbox WHERE id = $1",
          [eventId],
        )
      ).rows[0],
    );
    expect((stamped as { published_at: unknown }).published_at).not.toBeNull();

    // A second drain publishes nothing.
    const second = await store.drainTenant(tenant, async (event) => {
      delivered.push(event.id);
    });
    expect(second.published).toBe(0);
    expect(delivered).toEqual([eventId]);
  });

  it("dedupes a redelivery via event_inbox (exactly-once at the consumer)", async () => {
    const inbox = createPrismaConsumerInbox({ tier: "pool" });
    const messageId = randomUUID();

    const firstClaim = await inbox.markProcessed("notification", messageId, tenant);
    const secondClaim = await inbox.markProcessed("notification", messageId, tenant);

    expect(firstClaim).toBe(true); // first delivery processes
    expect(secondClaim).toBe(false); // redelivery is a no-op

    // Exactly one inbox row exists for this (consumer, message_id).
    const count = await withGuc(app, tenant, async (c) =>
      (
        await c.query(
          "SELECT 1 FROM event_inbox WHERE consumer = $1 AND message_id = $2",
          ["notification", messageId],
        )
      ).rowCount,
    );
    expect(count).toBe(1);
  });

  it("atomic ingestEvent: failure rolls back the claim, redelivery is exactly-once (no loss, no dupes)", async () => {
    // The notification consumer's atomic claim-and-apply over event_inbox +
    // notification, both in ONE withTenant transaction, runs through the app
    // RLS role (DATABASE_URL points at it). This is the exactly-once seam.
    const store = createNotificationStore();
    // pool tier → withTenant uses the shared pool built from DATABASE_URL (the
    // app RLS role, set in beforeAll); databaseUrl on ctx is unused for pool.
    const ctx = { tenantId: tenant, tier: "pool" as const, databaseUrl: appPoolUrl() };
    const messageId = randomUUID();
    const userId = randomUUID();

    // notification.user_id is NOT NULL REFERENCES app_user(id), so the
    // recipient must exist before the consumer fans out. Seed it under the
    // tenant GUC (app_user is RLS-scoped; WITH CHECK needs current_tenant_id()).
    await withGuc(app, tenant, async (c) => {
      await c.query(
        `INSERT INTO app_user (id, tenant_id, email, display_name, status)
         VALUES ($1, $2, $3, 'Relay Recipient', 'active')`,
        [userId, tenant, `recipient-${userId}@relay.test`],
      );
    });

    const inboxCount = async (): Promise<number | null> =>
      withGuc(app, tenant, async (c) =>
        (
          await c.query(
            "SELECT 1 FROM event_inbox WHERE consumer = $1 AND message_id = $2",
            ["notification", messageId],
          )
        ).rowCount,
      );
    const notifCount = async (): Promise<number | null> =>
      withGuc(app, tenant, async (c) =>
        (
          await c.query(
            "SELECT 1 FROM notification WHERE user_id = $1",
            [userId],
          )
        ).rowCount,
      );

    // 1) Simulate a consumer failure: the notification INSERT throws (invalid
    //    channel violates the CHECK constraint) INSIDE the same tx as the
    //    claim. Both must roll back — nothing persists.
    await expect(
      store.ingestEvent(ctx, messageId, [
        {
          userId,
          category: "grades",
          channel: "carrier-pigeon" as never,
          title: "Boom",
          status: "sent",
        },
      ]),
    ).rejects.toThrow();
    expect(await inboxCount()).toBe(0); // claim did NOT persist
    expect(await notifCount()).toBe(0); // notification did NOT persist

    // 2) Redelivery now succeeds: claims and creates EXACTLY the expected rows.
    const ok = await store.ingestEvent(ctx, messageId, [
      { userId, category: "grades", channel: "in_app", title: "Graded", status: "sent" },
    ]);
    expect(ok.claimed).toBe(true);
    expect(ok.notifications).toHaveLength(1);
    expect(await inboxCount()).toBe(1);
    expect(await notifCount()).toBe(1);

    // 3) A third redelivery of the same id is a no-op: deduped, no new rows.
    const dup = await store.ingestEvent(ctx, messageId, [
      { userId, category: "grades", channel: "in_app", title: "Graded again", status: "sent" },
    ]);
    expect(dup.claimed).toBe(false);
    expect(dup.notifications).toHaveLength(0);
    expect(await notifCount()).toBe(1); // still exactly one
  });
});
