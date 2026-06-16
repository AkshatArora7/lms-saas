import { withTenant } from "@lms/db";

import type {
  Channel,
  Inbox,
  NewNotificationInput,
  NotificationRecord,
  NotificationStatus,
  NotificationStore,
  PreferenceInput,
  PreferenceRecord,
} from "./store.js";

interface NotificationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  category: string;
  channel: Channel;
  title: string;
  body: string | null;
  data: unknown;
  status: NotificationStatus;
  created_at: Date | string;
  read_at: Date | string | null;
}

interface PreferenceRow {
  user_id: string;
  channel: Channel;
  category: string;
  is_enabled: boolean;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function asData(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    category: row.category,
    channel: row.channel,
    title: row.title,
    body: row.body,
    data: asData(row.data),
    status: row.status,
    createdAt: iso(row.created_at) ?? "",
    readAt: iso(row.read_at),
  };
}

function toPreference(row: PreferenceRow): PreferenceRecord {
  return {
    userId: row.user_id,
    channel: row.channel,
    category: row.category,
    isEnabled: row.is_enabled,
  };
}

const SELECT_NOTIFICATION = `
  SELECT id, tenant_id, user_id, category, channel, title, body, data,
         status, created_at, read_at
    FROM notification`;

/** The consumer name this service records in `event_inbox` for dedupe. */
const NOTIFICATION_CONSUMER = "notification";

/**
 * Insert one notification row inside an already-open tenant transaction `db`.
 * Shared by `createNotifications` and the atomic `ingestEvent` so the INSERT
 * shape stays in one place.
 */
async function insertNotification(
  db: {
    $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  },
  tenantId: string,
  row: NewNotificationInput,
): Promise<NotificationRecord> {
  const inserted = await db.$queryRawUnsafe<NotificationRow[]>(
    `INSERT INTO notification
       (tenant_id, user_id, category, channel, title, body, data, status)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING id, tenant_id, user_id, category, channel, title, body,
               data, status, created_at, read_at`,
    tenantId,
    row.userId,
    row.category,
    row.channel,
    row.title,
    row.body ?? null,
    JSON.stringify(row.data ?? {}),
    row.status ?? "queued",
  );
  return toNotification(inserted[0]!);
}

/**
 * Postgres-backed notification store. Every call runs through `withTenant`, so
 * all statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants.
 */
export function createPrismaStore(): NotificationStore {
  return {
    async listInbox(ctx, userId, opts = {}): Promise<Inbox> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<NotificationRow[]>(
          `${SELECT_NOTIFICATION}
            WHERE user_id = $1::uuid AND channel = 'in_app'
              ${opts.unreadOnly ? "AND read_at IS NULL" : ""}
            ORDER BY created_at DESC`,
          userId,
        );
        const unread = await db.$queryRawUnsafe<{ count: bigint | number }[]>(
          `SELECT COUNT(*)::int AS count FROM notification
            WHERE user_id = $1::uuid AND channel = 'in_app' AND read_at IS NULL`,
          userId,
        );
        return {
          notifications: rows.map(toNotification),
          unreadCount: Number(unread[0]?.count ?? 0),
        };
      });
    },

    async createNotifications(ctx, rows: NewNotificationInput[]) {
      if (rows.length === 0) return [];
      return withTenant(ctx, async (db) => {
        const created: NotificationRecord[] = [];
        for (const row of rows) {
          created.push(await insertNotification(db, ctx.tenantId, row));
        }
        return created;
      });
    },

    async ingestEvent(ctx, messageId, rows: NewNotificationInput[]) {
      // ONE tenant-scoped transaction (withTenant runs the callback inside a
      // single $transaction for pool tenants), so the inbox claim and the
      // notification inserts commit or roll back TOGETHER.
      return withTenant(ctx, async (db) => {
        const claimed = await db.$executeRawUnsafe(
          `INSERT INTO event_inbox (consumer, message_id, tenant_id)
           VALUES ($1, $2::uuid, $3::uuid)
           ON CONFLICT (consumer, message_id) DO NOTHING`,
          NOTIFICATION_CONSUMER,
          messageId,
          ctx.tenantId,
        );
        // rowCount === 0 means the event was already processed — a redelivery.
        // Insert nothing and report deduped; the relay treats this as success.
        if (claimed !== 1) {
          return { claimed: false, notifications: [] };
        }
        const created: NotificationRecord[] = [];
        for (const row of rows) {
          created.push(await insertNotification(db, ctx.tenantId, row));
        }
        return { claimed: true, notifications: created };
      });
    },

    async markRead(ctx, userId, notificationId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<NotificationRow[]>(
          `UPDATE notification
              SET read_at = COALESCE(read_at, now()),
                  status = 'read'
            WHERE id = $1::uuid AND user_id = $2::uuid
            RETURNING id, tenant_id, user_id, category, channel, title, body,
                      data, status, created_at, read_at`,
          notificationId,
          userId,
        );
        return rows[0] ? toNotification(rows[0]) : null;
      });
    },

    async markAllRead(ctx, userId) {
      return withTenant(ctx, async (db) => {
        return db.$executeRawUnsafe(
          `UPDATE notification
              SET read_at = now(), status = 'read'
            WHERE user_id = $1::uuid AND channel = 'in_app' AND read_at IS NULL`,
          userId,
        );
      });
    },

    async getPreferences(ctx, userId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<PreferenceRow[]>(
          `SELECT user_id, channel, category, is_enabled
             FROM notification_preference
            WHERE user_id = $1::uuid
            ORDER BY category, channel`,
          userId,
        );
        return rows.map(toPreference);
      });
    },

    async setPreferences(ctx, userId, prefs: PreferenceInput[]) {
      return withTenant(ctx, async (db) => {
        for (const pref of prefs) {
          await db.$executeRawUnsafe(
            `INSERT INTO notification_preference
               (tenant_id, user_id, channel, category, is_enabled)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5)
             ON CONFLICT (user_id, channel, category)
             DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
            ctx.tenantId,
            userId,
            pref.channel,
            pref.category,
            pref.isEnabled,
          );
        }
        const rows = await db.$queryRawUnsafe<PreferenceRow[]>(
          `SELECT user_id, channel, category, is_enabled
             FROM notification_preference
            WHERE user_id = $1::uuid
            ORDER BY category, channel`,
          userId,
        );
        return rows.map(toPreference);
      });
    },

    async flushDigest(ctx, userId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<NotificationRow[]>(
          `UPDATE notification
              SET status = 'sent'
            WHERE user_id = $1::uuid AND channel <> 'in_app' AND status = 'queued'
            RETURNING id, tenant_id, user_id, category, channel, title, body,
                      data, status, created_at, read_at`,
          userId,
        );
        return rows.map(toNotification);
      });
    },
  };
}
