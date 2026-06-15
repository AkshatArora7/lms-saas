import { TENANT_ID } from "./auth";

/**
 * Weekly timetable data for the learner schedule screen.
 *
 * In production this comes from the timetable backend (bell_schedule /
 * schedule_period / timetable_entry), tenant-scoped via the gateway. Until that
 * read path is wired in, we resolve a small, deterministic week for the seeded
 * demo tenant and an empty timetable for everyone else, so the screen renders a
 * real happy path and a real empty state with no backend dependency.
 */

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

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
  /** 24h start time, "HH:MM". */
  start: string;
  /** 24h end time, "HH:MM". */
  end: string;
  courseId: string;
  course: string;
  code: string;
  room: string;
  instructor: string;
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

const DEMO_ENTRIES: ScheduleEntry[] = [
  {
    id: "mon-1",
    day: "Monday",
    start: "09:00",
    end: "10:15",
    courseId: "course-alg2",
    course: "Algebra II",
    code: "MATH-201",
    room: "B204",
    instructor: "Ms. Carter",
  },
  {
    id: "mon-2",
    day: "Monday",
    start: "10:30",
    end: "11:45",
    courseId: "course-bio",
    course: "Biology",
    code: "SCI-110",
    room: "Lab 3",
    instructor: "Mr. Osei",
  },
  {
    id: "tue-1",
    day: "Tuesday",
    start: "09:00",
    end: "10:15",
    courseId: "course-eng",
    course: "English Literature",
    code: "ENG-150",
    room: "A112",
    instructor: "Mrs. Nguyen",
  },
  {
    id: "tue-2",
    day: "Tuesday",
    start: "13:00",
    end: "14:15",
    courseId: "course-hist",
    course: "World History",
    code: "HIST-120",
    room: "A210",
    instructor: "Mr. Dlamini",
  },
  {
    id: "wed-1",
    day: "Wednesday",
    start: "09:00",
    end: "10:15",
    courseId: "course-alg2",
    course: "Algebra II",
    code: "MATH-201",
    room: "B204",
    instructor: "Ms. Carter",
  },
  {
    id: "wed-2",
    day: "Wednesday",
    start: "11:00",
    end: "12:15",
    courseId: "course-cs",
    course: "Intro to Computer Science",
    code: "CS-101",
    room: "Lab 1",
    instructor: "Dr. Park",
  },
  {
    id: "thu-1",
    day: "Thursday",
    start: "10:30",
    end: "11:45",
    courseId: "course-bio",
    course: "Biology",
    code: "SCI-110",
    room: "Lab 3",
    instructor: "Mr. Osei",
  },
  {
    id: "thu-2",
    day: "Thursday",
    start: "13:00",
    end: "14:15",
    courseId: "course-eng",
    course: "English Literature",
    code: "ENG-150",
    room: "A112",
    instructor: "Mrs. Nguyen",
  },
  {
    id: "fri-1",
    day: "Friday",
    start: "09:00",
    end: "10:15",
    courseId: "course-cs",
    course: "Intro to Computer Science",
    code: "CS-101",
    room: "Lab 1",
    instructor: "Dr. Park",
  },
  {
    id: "fri-2",
    day: "Friday",
    start: "10:30",
    end: "11:45",
    courseId: "course-hist",
    course: "World History",
    code: "HIST-120",
    room: "A210",
    instructor: "Mr. Dlamini",
  },
];

function byStart(a: ScheduleEntry, b: ScheduleEntry): number {
  return a.start.localeCompare(b.start);
}

/** Resolve the learner's weekly timetable for the current tenant. */
export function getWeekSchedule(tenantId: string = TENANT_ID): ScheduleEntry[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_ENTRIES : [];
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
