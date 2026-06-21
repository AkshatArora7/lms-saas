import { TENANT_ID } from "./auth";
import { getEnrolledCourses } from "./enrolled";
import { listTimetable, listBellSchedules } from "./calendar-api";
import { getUser } from "./user-org-api";

/**
 * Weekly timetable data for the learner schedule screen, sourced live from the
 * calendar microservice via the BFF server-fetch pattern (tenant-scoped with
 * `x-tenant-id`). For each enrolled course offering we read its timetable
 * entries and the bell schedule that supplies each period's start/end times,
 * then compose the weekly view. Returns `[]` (driving the empty state) when no
 * timetable is published or a service is unreachable — no demo fallback.
 */

export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";

export const WEEKDAYS: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

export interface ScheduleEntry {
  id: string;
  day: Weekday;
  /** 24h start time, "HH:MM" (empty when the period has no time). */
  start: string;
  /** 24h end time, "HH:MM" (empty when the period has no time). */
  end: string;
  courseId: string;
  course: string;
  /** Course code — not modelled by the course service yet, hence nullable. */
  code: string | null;
  room: string;
  /** Instructor display name, resolved from user-org; null when none. */
  instructor: string | null;
}

export interface DaySchedule {
  day: Weekday;
  entries: ScheduleEntry[];
}

export interface ScheduleSummary {
  totalClasses: number;
  daysWithClasses: number;
  next: ScheduleEntry | null;
}

/** Normalise a Postgres time ("09:00:00") to a "HH:MM" display value. */
function normalizeTime(time: string | null | undefined): string {
  if (!time) return "";
  const timeMatch = time.match(/\b(\d{2}:\d{2})(?::\d{2})?\b/);
  if (timeMatch?.[1]) return timeMatch[1];
  const date = new Date(time);
  if (!Number.isNaN(date.getTime())) {
    return `${`${date.getUTCHours()}`.padStart(2, "0")}:${`${date.getUTCMinutes()}`.padStart(2, "0")}`;
  }
  return "";
}

function byStart(a: ScheduleEntry, b: ScheduleEntry): number {
  return a.start.localeCompare(b.start);
}

/**
 * Resolve the learner's weekly timetable live across enrolled course offerings.
 * Mon-Fri entries only; entries outside the teaching week are skipped. Returns
 * `[]` when no timetable is published or a service is unreachable.
 */
export async function getWeekSchedule(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<ScheduleEntry[]> {
  const enrolled = await getEnrolledCourses(userId, tenantId);
  const instructorCache = new Map<string, string | null>();
  const resolveInstructor = async (id: string): Promise<string | null> => {
    const cached = instructorCache.get(id);
    if (cached !== undefined) return cached;
    const user = await getUser(id, tenantId);
    const name = user?.displayName ?? null;
    instructorCache.set(id, name);
    return name;
  };

  const perCourse = await Promise.all(
    enrolled.map(async (course) => {
      const [entries, schedules] = await Promise.all([
        listTimetable(course.orgUnitId, tenantId),
        listBellSchedules(course.orgUnitId, tenantId),
      ]);

      const periods = new Map<string, { start: string; end: string }>();
      for (const schedule of schedules) {
        for (const period of schedule.periods) {
          periods.set(period.id, {
            start: normalizeTime(period.startTime),
            end: normalizeTime(period.endTime),
          });
        }
      }

      const out: ScheduleEntry[] = [];
      for (const entry of entries) {
        // dayOfWeek: 1 = Monday … 5 = Friday (0=Sun, 6=Sat skipped).
        if (entry.dayOfWeek == null || entry.dayOfWeek < 1 || entry.dayOfWeek > 5) {
          continue;
        }
        const day = WEEKDAYS[entry.dayOfWeek - 1];
        if (!day) continue;
        const period = periods.get(entry.periodId);
        const instructor = entry.instructorId
          ? await resolveInstructor(entry.instructorId)
          : null;
        out.push({
          id: entry.id,
          day,
          start: period?.start ?? "",
          end: period?.end ?? "",
          courseId: course.courseId,
          course: course.title,
          code: null,
          room: entry.room ?? "",
          instructor,
        });
      }
      return out;
    }),
  );

  return perCourse.flat();
}

/** Group timetable entries into ordered days, omitting empty days. */
export function groupByDay(entries: ScheduleEntry[]): DaySchedule[] {
  return WEEKDAYS.map((day) => ({
    day,
    entries: entries.filter((entry) => entry.day === day).sort(byStart),
  })).filter((group) => group.entries.length > 0);
}

/**
 * Summarise the week and find the next class relative to "now" within the
 * Mon-Fri teaching week. Deterministic: uses the current weekday/time, falling
 * back to the first class of the week when outside teaching hours.
 */
export function summarizeWeek(
  entries: ScheduleEntry[],
  now: Date = new Date(),
): ScheduleSummary {
  const daysWithClasses = new Set(entries.map((entry) => entry.day)).size;

  const dayIndex = now.getDay() - 1; // Monday = 0
  const currentDay = WEEKDAYS[dayIndex];
  const currentTime = `${`${now.getHours()}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}`;

  let next: ScheduleEntry | null = null;
  if (currentDay) {
    const todayUpcoming = entries
      .filter((entry) => entry.day === currentDay && entry.start >= currentTime)
      .sort(byStart);
    next = todayUpcoming[0] ?? null;
  }
  if (!next) {
    const fromTomorrow = WEEKDAYS.slice(Math.max(0, dayIndex + 1))
      .flatMap((day) => entries.filter((entry) => entry.day === day))
      .sort((a, b) => a.day.localeCompare(b.day) || byStart(a, b));
    next = fromTomorrow[0] ?? [...entries].sort(byStart)[0] ?? null;
  }

  return {
    totalClasses: entries.length,
    daysWithClasses,
    next,
  };
}
