import { TENANT_ID } from "./auth";

/**
 * Assignment data for the learner assignments / upcoming work screen.
 *
 * In production this comes from the assignment/grading microservices (EPIC
 * #44), tenant-scoped via the gateway. Until that read path is wired in, we
 * resolve a small, deterministic set for the seeded demo tenant and an empty
 * collection for everyone else, so the screen renders a real happy path and a
 * real empty state with no backend dependency.
 */

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

export type AssignmentType = "Assignment" | "Quiz" | "Project" | "Essay";

/** Raw, persisted submission state. "overdue" is derived, not stored. */
export type SubmissionState = "not_started" | "submitted" | "graded";

/** Display status including the derived "overdue" state. */
export type AssignmentStatus = SubmissionState | "overdue";

export interface Assignment {
  id: string;
  courseId: string;
  course: string;
  code: string;
  title: string;
  type: AssignmentType;
  points: number;
  /** ISO due date. */
  dueAt: string;
  state: SubmissionState;
  /** Present only when state is "graded". */
  score?: number;
}

export interface AssignmentView extends Assignment {
  status: AssignmentStatus;
}

export interface AssignmentsSummary {
  total: number;
  overdue: number;
  dueSoon: number;
  submitted: number;
}

const DEMO_ASSIGNMENTS: Assignment[] = [
  {
    id: "asg-1",
    courseId: "course-cs",
    course: "Intro to Computer Science",
    code: "CS-101",
    title: "Lab 4: Recursion",
    type: "Assignment",
    points: 20,
    dueAt: "2026-06-19T23:59:00Z",
    state: "not_started",
  },
  {
    id: "asg-2",
    courseId: "course-alg2",
    course: "Algebra II",
    code: "MATH-201",
    title: "Problem Set 7",
    type: "Assignment",
    points: 15,
    dueAt: "2026-06-16T23:59:00Z",
    state: "not_started",
  },
  {
    id: "asg-3",
    courseId: "course-eng",
    course: "English Literature",
    code: "ENG-150",
    title: "Comparative Essay",
    type: "Essay",
    points: 40,
    dueAt: "2026-06-22T23:59:00Z",
    state: "not_started",
  },
  {
    id: "asg-4",
    courseId: "course-bio",
    course: "Biology",
    code: "SCI-110",
    title: "Cell Structure Quiz",
    type: "Quiz",
    points: 10,
    dueAt: "2026-06-12T23:59:00Z",
    state: "submitted",
  },
  {
    id: "asg-5",
    courseId: "course-hist",
    course: "World History",
    code: "HIST-120",
    title: "Industrial Revolution Project",
    type: "Project",
    points: 50,
    dueAt: "2026-06-09T23:59:00Z",
    state: "graded",
    score: 46,
  },
  {
    id: "asg-6",
    courseId: "course-alg2",
    course: "Algebra II",
    code: "MATH-201",
    title: "Problem Set 6",
    type: "Assignment",
    points: 15,
    dueAt: "2026-06-08T23:59:00Z",
    state: "not_started",
  },
];

/** Number of days from `now` to a due date; negative means past due. */
const DUE_SOON_DAYS = 3;

function statusOf(assignment: Assignment, now: Date): AssignmentStatus {
  if (assignment.state !== "not_started") {
    return assignment.state;
  }
  return new Date(assignment.dueAt).getTime() < now.getTime()
    ? "overdue"
    : "not_started";
}

/** Rank for default sort: overdue first, then upcoming, then completed. */
function rank(status: AssignmentStatus): number {
  switch (status) {
    case "overdue":
      return 0;
    case "not_started":
      return 1;
    case "submitted":
      return 2;
    default:
      return 3;
  }
}

/**
 * Resolve the learner's assignments for the current tenant, annotated with a
 * derived status and sorted: overdue first, then by due date.
 */
export function getAssignments(
  tenantId: string = TENANT_ID,
  now: Date = new Date(),
): AssignmentView[] {
  if (tenantId !== DEMO_TENANT_ID) {
    return [];
  }
  return DEMO_ASSIGNMENTS.map((assignment) => ({
    ...assignment,
    status: statusOf(assignment, now),
  })).sort((a, b) => {
    const byRank = rank(a.status) - rank(b.status);
    return byRank !== 0 ? byRank : a.dueAt.localeCompare(b.dueAt);
  });
}

/** Summarise overdue / due-soon / submitted counts. */
export function summarizeAssignments(
  assignments: AssignmentView[],
  now: Date = new Date(),
): AssignmentsSummary {
  const soonCutoff = now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000;

  let overdue = 0;
  let dueSoon = 0;
  let submitted = 0;

  for (const assignment of assignments) {
    if (assignment.status === "overdue") {
      overdue += 1;
    } else if (assignment.status === "submitted" || assignment.status === "graded") {
      submitted += 1;
    } else if (new Date(assignment.dueAt).getTime() <= soonCutoff) {
      dueSoon += 1;
    }
  }

  return { total: assignments.length, overdue, dueSoon, submitted };
}

/** Format an ISO due date as a short, locale-stable label. */
export function formatDue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "No due date";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
