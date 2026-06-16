import { TENANT_ID } from "./auth";

/**
 * Server-only client for the attendance microservice.
 *
 * This is the BFF read boundary for a learner's own attendance history: the call
 * forwards the authenticated tenant as `x-tenant-id` (the trusted header the
 * gateway injects in production and the attendance service's resolver expects),
 * so all data stays tenant-scoped. The fetch returns a discriminated-union
 * result rather than throwing, so the Server Component can surface a clean error
 * state instead of a crashed render when the service is down.
 *
 * The pure helpers below (summarize / group / tone map) are intentionally
 * side-effect free so they can be unit-tested without a running service.
 */

export const ATTENDANCE_SERVICE_URL =
  process.env.ATTENDANCE_SERVICE_URL ?? "http://localhost:4025";

export type AttendanceCategory = "present" | "absent" | "tardy" | "excused";

/** A student's attendance history entry (record joined with its session).
 * Mirrors the backend `AttendanceHistoryEntry` shape. */
export interface AttendanceHistoryEntry {
  sessionId: string;
  orgUnitId: string;
  meetingDate: string;
  periodLabel: string | null;
  code: string;
  category: AttendanceCategory;
  minutesLate: number | null;
}

export type AttendanceResult =
  | { ok: true; history: AttendanceHistoryEntry[] }
  | { ok: false; error: string };

/** Header set for the read request — forwards the trusted tenant scope. */
function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return data.message ?? fallback;
}

const UNREACHABLE =
  "The attendance service is unreachable. Start it to view attendance.";

/**
 * Fetch the authenticated learner's attendance history, tenant-scoped. Returns a
 * discriminated union so the caller can render error/empty/data states without a
 * try/catch at the render site.
 */
export async function getUserAttendance(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<AttendanceResult> {
  try {
    const url = `${ATTENDANCE_SERVICE_URL}/users/${encodeURIComponent(userId)}/attendance`;
    const res = await fetch(url, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to load attendance."),
      };
    }
    const data = (await res.json()) as { history: AttendanceHistoryEntry[] };
    return { ok: true, history: data.history };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Counts by category plus a total, used to drive the summary KPI band. */
export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  tardy: number;
  excused: number;
}

/** Tally a history array into per-category counts. Pure. */
export function summarizeAttendance(
  history: AttendanceHistoryEntry[],
): AttendanceSummary {
  const summary: AttendanceSummary = {
    total: 0,
    present: 0,
    absent: 0,
    tardy: 0,
    excused: 0,
  };
  for (const entry of history) {
    summary.total += 1;
    summary[entry.category] += 1;
  }
  return summary;
}

/** A set of records that share a meeting date, for the grouped history view. */
export interface AttendanceDateGroup {
  meetingDate: string;
  records: AttendanceHistoryEntry[];
}

/**
 * Group history entries by `meetingDate`, with the groups ordered most-recent
 * first and the records inside each group ordered by `periodLabel` ascending
 * (null period labels sort last). Pure — does not mutate the input.
 */
export function groupAttendanceByDate(
  history: AttendanceHistoryEntry[],
): AttendanceDateGroup[] {
  const byDate = new Map<string, AttendanceHistoryEntry[]>();
  for (const entry of history) {
    const bucket = byDate.get(entry.meetingDate);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.meetingDate, [entry]);
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([meetingDate, records]) => ({
      meetingDate,
      records: [...records].sort((a, b) => comparePeriodLabel(a, b)),
    }));
}

/** Sort by period label ascending, with null labels pushed to the end. */
function comparePeriodLabel(
  a: AttendanceHistoryEntry,
  b: AttendanceHistoryEntry,
): number {
  if (a.periodLabel === b.periodLabel) return 0;
  if (a.periodLabel === null) return 1;
  if (b.periodLabel === null) return -1;
  return a.periodLabel.localeCompare(b.periodLabel, undefined, {
    numeric: true,
  });
}

/** A status badge tone aligned to the shared @lms/ui BadgeTone vocabulary. */
export type AttendanceTone = "success" | "danger" | "warning" | "neutral";

/** Human label + supplementary tone for each category. Colour is never the only
 * signal — the label always conveys the status in text. */
export const ATTENDANCE_DISPLAY: Record<
  AttendanceCategory,
  { label: string; tone: AttendanceTone }
> = {
  present: { label: "Present", tone: "success" },
  absent: { label: "Absent", tone: "danger" },
  tardy: { label: "Tardy", tone: "warning" },
  excused: { label: "Excused", tone: "neutral" },
};
