import type { TenantContext } from "@lms/types";

/** Delivery channels supported by the schema's notification tables. */
export const CHANNELS = ["in_app", "email", "sms", "push"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Lifecycle of a notification row. */
export type NotificationStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "read";

/** A single notification addressed to one user on one channel. */
export interface NotificationRecord {
  id: string;
  tenantId: string;
  userId: string;
  category: string;
  channel: Channel;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  status: NotificationStatus;
  createdAt: string;
  readAt: string | null;
}

/** Per-user, per-category, per-channel opt-in flag. */
export interface PreferenceRecord {
  userId: string;
  channel: Channel;
  category: string;
  isEnabled: boolean;
}

export interface NewNotificationInput {
  userId: string;
  category: string;
  channel: Channel;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  status?: NotificationStatus;
}

export interface PreferenceInput {
  channel: Channel;
  category: string;
  isEnabled: boolean;
}

/** A user's in-app inbox plus the unread counter the UI badges. */
export interface Inbox {
  notifications: NotificationRecord[];
  unreadCount: number;
}

/** Quiet-hours window expressed as inclusive start / exclusive end hours (0-23). */
export interface QuietHours {
  startHour: number;
  endHour: number;
}

/**
 * Persistence boundary for the notification service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the other domain services.
 */
export interface NotificationStore {
  /** In-app inbox (newest first) plus unread count. */
  listInbox(
    ctx: TenantContext,
    userId: string,
    opts?: { unreadOnly?: boolean },
  ): Promise<Inbox>;

  /** Bulk-create notifications (fan-out writes one row per enabled channel). */
  createNotifications(
    ctx: TenantContext,
    rows: NewNotificationInput[],
  ): Promise<NotificationRecord[]>;

  /**
   * Atomically dedupe-and-apply a domain event delivery for the `notification`
   * consumer. In ONE tenant-scoped transaction, claim `(consumer='notification',
   * messageId)` in `event_inbox` via `INSERT ... ON CONFLICT DO NOTHING`:
   *
   *  - First delivery (claimed): insert the notification `rows` IN THE SAME tx
   *    and return `{ claimed: true, notifications }`. Claim + side-effect commit
   *    or roll back together — so if the inserts fail, the claim never persists.
   *  - Redelivery (already claimed): insert nothing and return
   *    `{ claimed: false, notifications: [] }`.
   *
   * This is the exactly-once seam: the relay's at-least-once redelivery becomes
   * an idempotent no-op because the claim and the effect share one transaction.
   */
  ingestEvent(
    ctx: TenantContext,
    messageId: string,
    rows: NewNotificationInput[],
  ): Promise<{ claimed: boolean; notifications: NotificationRecord[] }>;

  /** Mark one notification read; null when it is not the user's / unknown. */
  markRead(
    ctx: TenantContext,
    userId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null>;

  /** Mark every unread in-app notification read; returns the count updated. */
  markAllRead(ctx: TenantContext, userId: string): Promise<number>;

  getPreferences(ctx: TenantContext, userId: string): Promise<PreferenceRecord[]>;

  /** Upsert a batch of preferences; returns the user's full preference set. */
  setPreferences(
    ctx: TenantContext,
    userId: string,
    prefs: PreferenceInput[],
  ): Promise<PreferenceRecord[]>;

  /**
   * Release queued (digest-held) non-in-app notifications for a user, flipping
   * them to `sent`. Returns the notifications that were flushed.
   */
  flushDigest(
    ctx: TenantContext,
    userId: string,
  ): Promise<NotificationRecord[]>;
}

const DEFAULT_CATEGORY = "general";

/** Map a domain event type (e.g. `grade.released`) to a notification category. */
export function categoryForEvent(type: string): string {
  const head = type.split(".")[0] ?? "";
  switch (head) {
    case "grade":
    case "grading":
    case "quiz":
      return "grades";
    case "discussion":
      return "discussions";
    case "announcement":
      return "announcements";
    case "assignment":
      return "assignments";
    case "enrollment":
      return "enrollments";
    default:
      return DEFAULT_CATEGORY;
  }
}

/** True when `date`'s hour falls inside the quiet-hours window (wraps midnight). */
export function isWithinQuietHours(date: Date, quiet?: QuietHours): boolean {
  if (!quiet) return false;
  const hour = date.getUTCHours();
  const { startHour, endHour } = quiet;
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

export interface PlanDeliveryInput {
  category: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  recipientIds: string[];
  /** Per-user enabled (category, channel) pairs. Missing entry → channel default. */
  prefsByUser: Map<string, PreferenceRecord[]>;
  quietHours?: QuietHours;
  now?: Date;
}

/** Channels enabled by default when a user has no explicit preference row. */
const DEFAULT_ENABLED_CHANNELS: Channel[] = ["in_app", "email"];

function channelEnabled(
  prefs: PreferenceRecord[] | undefined,
  category: string,
  channel: Channel,
): boolean {
  const match = prefs?.find(
    (p) => p.category === category && p.channel === channel,
  );
  if (match) return match.isEnabled;
  return DEFAULT_ENABLED_CHANNELS.includes(channel);
}

/**
 * Pure fan-out planner. For each recipient and each enabled channel, produce a
 * notification row. In-app notifications always deliver immediately (`sent`);
 * other channels delivered during quiet hours are held for the digest
 * (`queued`) instead of being sent.
 */
export function planDeliveries(input: PlanDeliveryInput): NewNotificationInput[] {
  const now = input.now ?? new Date();
  const quiet = isWithinQuietHours(now, input.quietHours);
  const rows: NewNotificationInput[] = [];

  for (const userId of input.recipientIds) {
    const prefs = input.prefsByUser.get(userId);
    for (const channel of CHANNELS) {
      if (!channelEnabled(prefs, input.category, channel)) continue;
      const deferred = channel !== "in_app" && quiet;
      rows.push({
        userId,
        category: input.category,
        channel,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? {},
        status: deferred ? "queued" : "sent",
      });
    }
  }
  return rows;
}
