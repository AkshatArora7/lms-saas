import { EVENT_TYPES } from "@lms/events";

import type { VideoRecord } from "./store.js";

/** Outbox reason strings are short; never carry a stack trace or secret. */
const MAX_REASON_LENGTH = 500;

/**
 * Shared outbox-event shape produced by both the Prisma and memory stores so the
 * payload is identical by construction (mirrors `services/attendance/src/events.ts`).
 * `actorId`/`orgUnitId` map to the nullable `event_outbox.actor_id`/`org_unit_id`
 * columns; `tenant_id`/`occurred_at` are stamped by the store at INSERT time.
 */
export interface VideoOutboxEvent {
  type: string;
  actorId: string | null;
  orgUnitId: string | null;
  payload: Record<string, unknown>;
}

/**
 * Build the `video.ready` outbox event for a freshly-transcoded asset. The
 * record must already carry its renditions/captions/duration (build it from the
 * `RETURNING` row of the status flip). `recipientIds` wires the existing
 * notification fan-out; the remaining fields serve a future search-index
 * consumer. `orgUnitId` is `null` (video has no org unit; `courseId` rides the
 * payload — see ADR-0035).
 */
export function videoReadyEvent(v: VideoRecord): VideoOutboxEvent {
  return {
    type: EVENT_TYPES.VIDEO_READY,
    actorId: v.ownerId ?? null,
    orgUnitId: null,
    payload: {
      videoId: v.id,
      courseId: v.courseId,
      title: v.title,
      durationSeconds: v.durationSeconds,
      renditionCount: v.renditions.length,
      captionLangs: v.captions.map((c) => c.lang),
      ownerId: v.ownerId,
      recipientIds: v.ownerId ? [v.ownerId] : [],
    },
  };
}

/**
 * Build the `video.failed` outbox event. `reason` is a short message (truncated)
 * — never a stack trace or secret.
 */
export function videoFailedEvent(
  v: VideoRecord,
  reason: string,
): VideoOutboxEvent {
  return {
    type: EVENT_TYPES.VIDEO_FAILED,
    actorId: v.ownerId ?? null,
    orgUnitId: null,
    payload: {
      videoId: v.id,
      courseId: v.courseId,
      title: v.title,
      ownerId: v.ownerId,
      reason: reason.slice(0, MAX_REASON_LENGTH),
      recipientIds: v.ownerId ? [v.ownerId] : [],
    },
  };
}
