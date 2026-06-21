import { TENANT_ID } from "./auth";
import { getEnrolledCourses } from "./enrolled";
import {
  listAssignments,
  listSubmissions,
  type Assignment as AssignmentRecord,
} from "./assignments-api";

/**
 * Assignment data for the learner assignments / upcoming work screen, sourced
 * live from the assignment microservice via the BFF server-fetch pattern
 * (tenant-scoped with `x-tenant-id`). For each enrolled course we read its
 * assignments and the learner's submission state. Returns `[]` (driving the
 * empty state) when there is no work or a service is unreachable — no demo
 * fallback.
 */

export type AssignmentType = "Assignment" | "Quiz" | "Project" | "Essay";

/** Raw, persisted submission state. "overdue" is derived, not stored. */
export type SubmissionState = "not_started" | "submitted" | "graded";

/** Display status including the derived "overdue" state. */
export type AssignmentStatus = SubmissionState | "overdue";

export interface Assignment {
  id: string;
  courseId: string;
  course: string;
  /** Course code — not modelled by the course service yet, hence nullable. */
  code: string | null;
  title: string;
  type: AssignmentType;
  points: number;
  /** ISO due date (empty string when none is set). */
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

/** Number of days from `now` to a due date; negative means past due. */
const DUE_SOON_DAYS = 3;

function statusOf(assignment: Assignment, now: Date): AssignmentStatus {
  if (assignment.state !== "not_started") {
    return assignment.state;
  }
  if (!assignment.dueAt) return "not_started";
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

/** Map a persisted submission status to the learner-facing state. */
function submissionState(status: string | undefined): SubmissionState {
  if (status === "graded" || status === "returned") return "graded";
  if (status) return "submitted";
  return "not_started";
}

/**
 * Resolve the learner's assignments across enrolled courses, annotated with a
 * derived status and sorted: overdue first, then by due date.
 */
export async function getAssignments(
  userId: string,
  tenantId: string = TENANT_ID,
  now: Date = new Date(),
): Promise<AssignmentView[]> {
  const enrolled = await getEnrolledCourses(userId, tenantId);
  const perCourse = await Promise.all(
    enrolled.map(async (course) => {
      const result = await listAssignments(course.courseId, tenantId);
      if (!result.ok) return [] as Assignment[];
      const assignments = await Promise.all(
        result.assignments.map(async (record: AssignmentRecord) => {
          const submissions = await listSubmissions(record.id, tenantId);
          const mine = submissions.find((s) => s.userId === userId);
          return {
            id: record.id,
            courseId: course.courseId,
            course: course.title,
            code: null,
            title: record.title,
            type: "Assignment" as AssignmentType,
            points: record.points,
            dueAt: record.dueAt ?? "",
            state: submissionState(mine?.status),
          } satisfies Assignment;
        }),
      );
      return assignments;
    }),
  );

  return perCourse
    .flat()
    .map((assignment) => ({
      ...assignment,
      status: statusOf(assignment, now),
    }))
    .sort((a, b) => {
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
