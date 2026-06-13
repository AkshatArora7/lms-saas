import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  Channel,
  Inbox,
  NewNotificationInput,
  NotificationRecord,
  NotificationStore,
  PreferenceInput,
  PreferenceRecord,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory NotificationStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `NOTIFICATION_STORE=memory`.
 */
export class MemoryNotificationStore implements NotificationStore {
  private notifications: NotificationRecord[] = [];
  private preferences: PreferenceRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  seedNotification(row: NotificationRecord): void {
    this.notifications.push(row);
  }
  seedPreference(row: PreferenceRecord & { tenantId: string }): void {
    this.preferences.push({
      userId: row.userId,
      channel: row.channel,
      category: row.category,
      isEnabled: row.isEnabled,
    });
    this.prefTenant.set(this.prefKey(row.userId, row.channel, row.category), row.tenantId);
  }

  /** Tenant ownership of preference rows (PreferenceRecord omits tenantId). */
  private prefTenant = new Map<string, string>();
  private prefKey(userId: string, channel: Channel, category: string): string {
    return `${userId}::${channel}::${category}`;
  }

  async listInbox(
    ctx: TenantContext,
    userId: string,
    opts: { unreadOnly?: boolean } = {},
  ): Promise<Inbox> {
    const mine = this.notifications.filter(
      (n) =>
        n.tenantId === ctx.tenantId &&
        n.userId === userId &&
        n.channel === "in_app",
    );
    const unreadCount = mine.filter((n) => n.readAt === null).length;
    const visible = (opts.unreadOnly ? mine.filter((n) => n.readAt === null) : mine)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { notifications: visible, unreadCount };
  }

  async createNotifications(
    ctx: TenantContext,
    rows: NewNotificationInput[],
  ): Promise<NotificationRecord[]> {
    const created = rows.map((row) => {
      const record: NotificationRecord = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        userId: row.userId,
        category: row.category,
        channel: row.channel,
        title: row.title,
        body: row.body ?? null,
        data: row.data ?? {},
        status: row.status ?? "queued",
        createdAt: this.now().toISOString(),
        readAt: null,
      };
      this.notifications.push(record);
      return record;
    });
    return created;
  }

  async markRead(
    ctx: TenantContext,
    userId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null> {
    const found = this.notifications.find(
      (n) =>
        n.id === notificationId &&
        n.tenantId === ctx.tenantId &&
        n.userId === userId,
    );
    if (!found) return null;
    if (found.readAt === null) {
      found.readAt = this.now().toISOString();
      found.status = "read";
    }
    return found;
  }

  async markAllRead(ctx: TenantContext, userId: string): Promise<number> {
    let count = 0;
    for (const n of this.notifications) {
      if (
        n.tenantId === ctx.tenantId &&
        n.userId === userId &&
        n.channel === "in_app" &&
        n.readAt === null
      ) {
        n.readAt = this.now().toISOString();
        n.status = "read";
        count += 1;
      }
    }
    return count;
  }

  async getPreferences(
    ctx: TenantContext,
    userId: string,
  ): Promise<PreferenceRecord[]> {
    return this.preferences.filter(
      (p) =>
        p.userId === userId &&
        this.prefTenant.get(this.prefKey(p.userId, p.channel, p.category)) ===
          ctx.tenantId,
    );
  }

  async setPreferences(
    ctx: TenantContext,
    userId: string,
    prefs: PreferenceInput[],
  ): Promise<PreferenceRecord[]> {
    for (const pref of prefs) {
      const existing = this.preferences.find(
        (p) =>
          p.userId === userId &&
          p.channel === pref.channel &&
          p.category === pref.category &&
          this.prefTenant.get(this.prefKey(userId, p.channel, p.category)) ===
            ctx.tenantId,
      );
      if (existing) {
        existing.isEnabled = pref.isEnabled;
      } else {
        this.preferences.push({
          userId,
          channel: pref.channel,
          category: pref.category,
          isEnabled: pref.isEnabled,
        });
        this.prefTenant.set(
          this.prefKey(userId, pref.channel, pref.category),
          ctx.tenantId,
        );
      }
    }
    return this.getPreferences(ctx, userId);
  }

  async flushDigest(
    ctx: TenantContext,
    userId: string,
  ): Promise<NotificationRecord[]> {
    const flushed: NotificationRecord[] = [];
    for (const n of this.notifications) {
      if (
        n.tenantId === ctx.tenantId &&
        n.userId === userId &&
        n.channel !== "in_app" &&
        n.status === "queued"
      ) {
        n.status = "sent";
        flushed.push(n);
      }
    }
    return flushed;
  }
}

/** Build a MemoryNotificationStore pre-seeded with a demo inbox + preference. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryNotificationStore {
  const store = new MemoryNotificationStore(generateId, now);
  store.seedNotification({
    id: "demo-notif-1",
    tenantId: DEMO_TENANT_ID,
    userId: "demo-user",
    category: "announcements",
    channel: "in_app",
    title: "Welcome to the course",
    body: "Your instructor posted a welcome announcement.",
    data: {},
    status: "sent",
    createdAt: new Date(0).toISOString(),
    readAt: null,
  });
  store.seedPreference({
    tenantId: DEMO_TENANT_ID,
    userId: "demo-user",
    channel: "email",
    category: "announcements",
    isEnabled: true,
  });
  return store;
}
