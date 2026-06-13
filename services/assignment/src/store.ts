import type { TenantContext } from "@lms/types";

export type SubmissionType = "file" | "text" | "url" | "none";

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "returned"
  | "resubmitted";

/** An assignment with a due/late policy, owned by a course. */
export interface AssignmentRecord {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  points: number;
  submissionType: SubmissionType;
  allowLate: boolean;
  createdAt: string;
}

/** A user's submission to an assignment (one per assignment+user). */
export interface SubmissionRecord {
  id: string;
  tenantId: string;
  assignmentId: string;
  userId: string;
  body: string | null;
  blobUrl: string | null;
  status: SubmissionStatus;
  submittedAt: string;
  isLate: boolean;
}

export interface NewAssignmentInput {
  courseId: string;
  title: string;
  instructions?: string | null;
  dueAt?: string | null;
  points?: number;
  submissionType?: SubmissionType;
  allowLate?: boolean;
}

export interface NewSubmissionInput {
  userId: string;
  body?: string | null;
  blobUrl?: string | null;
}

export type SubmitResult =
  | { ok: true; submission: SubmissionRecord; resubmitted: boolean }
  | {
      ok: false;
      reason: "unknown_assignment" | "late_not_allowed";
    };

/**
 * Persistence boundary for the assignment service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the course/enrollment/grading
 * services.
 */
export interface AssignmentStore {
  createAssignment(
    ctx: TenantContext,
    input: NewAssignmentInput,
  ): Promise<AssignmentRecord>;

  getAssignment(
    ctx: TenantContext,
    id: string,
  ): Promise<AssignmentRecord | null>;

  listAssignments(
    ctx: TenantContext,
    courseId: string,
  ): Promise<AssignmentRecord[]>;

  /**
   * Submit (or resubmit) on behalf of a user. Flags `is_late` when past the due
   * date, and rejects late submissions when the assignment forbids them.
   */
  submit(
    ctx: TenantContext,
    assignmentId: string,
    input: NewSubmissionInput,
  ): Promise<SubmitResult>;

  listSubmissions(
    ctx: TenantContext,
    assignmentId: string,
  ): Promise<SubmissionRecord[]>;

  getSubmission(
    ctx: TenantContext,
    id: string,
  ): Promise<SubmissionRecord | null>;

  /** Mark a submission returned (e.g. after grading). */
  returnSubmission(
    ctx: TenantContext,
    id: string,
  ): Promise<SubmissionRecord | null>;
}
