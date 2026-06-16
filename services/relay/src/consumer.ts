import type { EventEnvelope, EventHandler } from "@lms/events";

/** The consumer name recorded in event_inbox for the notification fan-out. */
export const NOTIFICATION_CONSUMER = "notification";

/**
 * A function that fans an envelope out into notifications for a tenant. In
 * production this is a thin adapter around the notification service's
 * `POST /events` (the HttpTransport path); in tests it is an in-memory spy.
 */
export type NotificationFanOut = (event: EventEnvelope) => Promise<void>;

/**
 * Shape the notification service's `POST /events` body expects, derived from an
 * envelope's payload (pure helper). Returns null when the event carries no
 * recipients to notify. The notification service maps `type` -> category and
 * applies per-user preferences itself.
 */
export function fanOutRequestFromEvent(event: EventEnvelope): {
  type: string;
  title: string;
  recipientIds: string[];
  data: Record<string, unknown>;
} | null {
  const payload = event.payload ?? {};
  const recipientIds = Array.isArray(payload.recipientIds)
    ? (payload.recipientIds as unknown[]).filter(
        (r): r is string => typeof r === "string" && r.trim().length > 0,
      )
    : [];
  if (recipientIds.length === 0) return null;
  const title =
    typeof payload.title === "string" && payload.title.trim().length > 0
      ? payload.title.trim()
      : event.type;
  return {
    type: event.type,
    title,
    recipientIds,
    data: payload,
  };
}

/**
 * Build the notification consumer handler the relay's transport dispatches to.
 *
 * EXACTLY-ONCE: dedupe is no longer done here. The relay's delivery is now
 * at-least-once, and exactly-once is enforced INSIDE the notification consumer:
 * `fanOut` posts the event id (`message_id`) to the notification service, which
 * claims `(consumer='notification', message_id)` in `event_inbox` AND inserts
 * the notifications in ONE transaction (`NotificationStore.ingestEvent`). A
 * redelivery is an idempotent no-op there — so a transient failure can never
 * lose a notification, and a retry can never duplicate one. The handler simply
 * skips events that name no recipients.
 */
export function notificationConsumerHandler(
  fanOut: NotificationFanOut,
): EventHandler {
  return async (event: EventEnvelope) => {
    if (!fanOutRequestFromEvent(event)) return; // nothing to notify.
    await fanOut(event);
  };
}
