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

export interface AttendanceEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Build the outbox event for a flagged (absent/tardy) attendance record. The
 * payload carries `recipientIds` so the notification consumer fans it out and
 * applies each recipient's preferences. Guardian recipients are added once the
 * guardian model lands (#24/#190); for now the learner is the recipient.
 */
export function attendanceEvent(
  sessionId: string,
  orgUnitId: string | null,
  record: FlaggedRecord,
): AttendanceEvent {
  return {
    type: EVENT_TYPES.ATTENDANCE_FLAGGED,
    payload: {
      sessionId,
      orgUnitId,
      userId: record.userId,
      code: record.code,
      category: record.category,
      recipientIds: [record.userId],
      category_label: record.category,
      title:
        record.category === "absent"
          ? "Absence recorded"
          : "Tardy recorded",
    },
  };
}
