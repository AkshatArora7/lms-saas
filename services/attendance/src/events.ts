import { EVENT_TYPES } from "@lms/events";

import type { AttendanceCategory } from "./store.js";

/** Categories that trigger a notification to the learner (and guardians). */
export const NOTIFIABLE_CATEGORIES: readonly AttendanceCategory[] = [
  "absent",
  "tardy",
];

export interface FlaggedRecord {
  userId: string;
  code: string;
  category: AttendanceCategory;
}

/**
 * Build the recipient list for a flagged record: the subject learner followed by
 * the resolved guardian ids, order-preserving and deduped (so a guardian who is
 * also the learner — an unlikely edge — appears once).
 */
export function recipientsFor(
  learnerUserId: string,
  guardianUserIds: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [learnerUserId, ...guardianUserIds]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export interface AttendanceEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Build the outbox event for a flagged (absent/tardy) attendance record. Pure:
 * the caller (the store) resolves recipients asynchronously and passes the full,
 * already-deduped list in. `payload.recipientIds` is fanned out by the
 * notification consumer, which applies EACH recipient's own preferences; the
 * list includes the subject learner plus any active+consented guardians (#101).
 * `payload.userId` stays the subject learner.
 */
export function attendanceEvent(
  sessionId: string,
  orgUnitId: string | null,
  record: FlaggedRecord,
  recipientIds: string[],
): AttendanceEvent {
  return {
    type: EVENT_TYPES.ATTENDANCE_FLAGGED,
    payload: {
      sessionId,
      orgUnitId,
      userId: record.userId,
      code: record.code,
      category: record.category,
      recipientIds,
      category_label: record.category,
      title:
        record.category === "absent"
          ? "Absence recorded"
          : "Tardy recorded",
    },
  };
}
