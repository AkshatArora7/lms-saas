/**
 * SCORM RTE (Run-Time Environment) cmi → normalized-status mapping (issue #31).
 *
 * The runtime route accepts EITHER SCORM 1.2 (`cmi.core.lesson_status`,
 * `cmi.core.score.raw`) OR SCORM 2004 (`cmi.completion_status`,
 * `cmi.success_status`, `cmi.score.scaled/raw`) fields. This PURE helper folds
 * both dialects into the single normalized model persisted by `scorm_attempt`
 * (handshake §E). No store, no I/O — unit-testable in isolation.
 */

export type CompletionStatus =
  | "completed"
  | "incomplete"
  | "not_attempted"
  | "unknown";
export type SuccessStatus = "passed" | "failed" | "unknown";

/** Raw cmi fields as sent by either SCORM 1.2 or 2004 clients. */
export interface RawCmi {
  /** SCORM 1.2 cmi.core.lesson_status (passed/completed/failed/incomplete/…). */
  lessonStatus?: string | null;
  /** SCORM 2004 cmi.completion_status. */
  completionStatus?: string | null;
  /** SCORM 2004 cmi.success_status. */
  successStatus?: string | null;
  /** SCORM 2004 cmi.score.scaled (−1..1). */
  scoreScaled?: number | null;
  /** cmi.core.score.raw / cmi.score.raw (as reported). */
  scoreRaw?: number | null;
  /** cmi.core.score.max — used to derive scaled when scaled is absent. */
  scoreMax?: number | null;
  /** Raw cmi session time. */
  sessionTime?: string | null;
  /** Optional accumulated cmi total time. */
  totalTime?: string | null;
}

export interface NormalizedCmi {
  completionStatus: CompletionStatus;
  successStatus: SuccessStatus;
  scoreScaled: number | null;
  scoreRaw: number | null;
  lessonStatus: string | null;
  sessionTime: string | null;
  totalTime: string | null;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function isCompletionStatus(v: string): v is CompletionStatus {
  return (
    v === "completed" ||
    v === "incomplete" ||
    v === "not_attempted" ||
    v === "unknown"
  );
}

function isSuccessStatus(v: string): v is SuccessStatus {
  return v === "passed" || v === "failed" || v === "unknown";
}

/** Map a SCORM 1.2 lesson_status verb into normalized completion + success. */
function mapLessonStatus(status: string): {
  completion: CompletionStatus;
  success: SuccessStatus;
} {
  switch (status.toLowerCase().trim()) {
    case "passed":
      return { completion: "completed", success: "passed" };
    case "completed":
      return { completion: "completed", success: "unknown" };
    case "failed":
      return { completion: "completed", success: "failed" };
    case "incomplete":
    case "browsed":
      return { completion: "incomplete", success: "unknown" };
    case "not attempted":
    case "not_attempted":
      return { completion: "not_attempted", success: "unknown" };
    default:
      return { completion: "unknown", success: "unknown" };
  }
}

/**
 * Normalize raw cmi fields from either SCORM dialect. 2004 status fields, when
 * present, take precedence; otherwise the 1.2 lesson_status mapping applies.
 */
export function normalizeCmi(raw: RawCmi): NormalizedCmi {
  let completion: CompletionStatus = "unknown";
  let success: SuccessStatus = "unknown";

  // SCORM 1.2 lesson_status (kept verbatim for fidelity).
  const lessonStatus =
    typeof raw.lessonStatus === "string" && raw.lessonStatus.trim().length > 0
      ? raw.lessonStatus
      : null;
  if (lessonStatus) {
    const mapped = mapLessonStatus(lessonStatus);
    completion = mapped.completion;
    success = mapped.success;
  }

  // SCORM 2004 explicit status fields override the 1.2 mapping when valid.
  if (typeof raw.completionStatus === "string") {
    const c = raw.completionStatus.toLowerCase().trim();
    if (isCompletionStatus(c)) completion = c;
  }
  if (typeof raw.successStatus === "string") {
    const s = raw.successStatus.toLowerCase().trim();
    if (isSuccessStatus(s)) success = s;
  }

  // Score: prefer an explicit scaled value; else derive from raw/max.
  let scoreScaled: number | null = null;
  if (typeof raw.scoreScaled === "number" && Number.isFinite(raw.scoreScaled)) {
    scoreScaled = clamp01(raw.scoreScaled);
  } else if (
    typeof raw.scoreRaw === "number" &&
    Number.isFinite(raw.scoreRaw) &&
    typeof raw.scoreMax === "number" &&
    Number.isFinite(raw.scoreMax) &&
    raw.scoreMax > 0
  ) {
    scoreScaled = clamp01(raw.scoreRaw / raw.scoreMax);
  }

  const scoreRaw =
    typeof raw.scoreRaw === "number" && Number.isFinite(raw.scoreRaw)
      ? raw.scoreRaw
      : null;

  const sessionTime =
    typeof raw.sessionTime === "string" && raw.sessionTime.length > 0
      ? raw.sessionTime
      : null;
  const totalTime =
    typeof raw.totalTime === "string" && raw.totalTime.length > 0
      ? raw.totalTime
      : null;

  return {
    completionStatus: completion,
    successStatus: success,
    scoreScaled,
    scoreRaw,
    lessonStatus,
    sessionTime,
    totalTime,
  };
}

/**
 * Pass determination for the gradebook event (handshake §E): passed when the
 * success status is `passed`, OR when a mastery score is set and the scaled
 * score meets it.
 */
export function isPassing(
  normalized: Pick<NormalizedCmi, "successStatus" | "scoreScaled">,
  masteryScore: number | null,
): boolean {
  if (normalized.successStatus === "passed") return true;
  if (
    masteryScore !== null &&
    normalized.scoreScaled !== null &&
    normalized.scoreScaled >= masteryScore
  ) {
    return true;
  }
  return false;
}
