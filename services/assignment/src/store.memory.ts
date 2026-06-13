import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  AssignmentRecord,
  AssignmentStore,
  NewAssignmentInput,
  NewSubmissionInput,
  SubmissionRecord,
  SubmitResult,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory AssignmentStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `ASSIGNMENT_STORE=memory`.
 */
export class MemoryAssignmentStore implements AssignmentStore {
  private assignments: AssignmentRecord[] = [];
  private submissions: SubmissionRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  seedAssignment(assignment: AssignmentRecord): void {
    this.assignments.push(assignment);
  }
  seedSubmission(submission: SubmissionRecord): void {
    this.submissions.push(submission);
  }

  async createAssignment(
    ctx: TenantContext,
    input: NewAssignmentInput,
  ): Promise<AssignmentRecord> {
    const assignment: AssignmentRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId: input.courseId,
      title: input.title,
      instructions: input.instructions ?? null,
      dueAt: input.dueAt ?? null,
      points: input.points ?? 100,
      submissionType: input.submissionType ?? "file",
      allowLate: input.allowLate ?? true,
      createdAt: this.now().toISOString(),
    };
    this.assignments.push(assignment);
    return assignment;
  }

  async getAssignment(
    ctx: TenantContext,
    id: string,
  ): Promise<AssignmentRecord | null> {
    return (
      this.assignments.find(
        (a) => a.id === id && a.tenantId === ctx.tenantId,
      ) ?? null
    );
  }

  async listAssignments(
    ctx: TenantContext,
    courseId: string,
  ): Promise<AssignmentRecord[]> {
    return this.assignments.filter(
      (a) => a.tenantId === ctx.tenantId && a.courseId === courseId,
    );
  }

  async submit(
    ctx: TenantContext,
    assignmentId: string,
    input: NewSubmissionInput,
  ): Promise<SubmitResult> {
    const assignment = this.assignments.find(
      (a) => a.id === assignmentId && a.tenantId === ctx.tenantId,
    );
    if (!assignment) return { ok: false, reason: "unknown_assignment" };

    const now = this.now();
    const isLate =
      assignment.dueAt !== null && now > new Date(assignment.dueAt);
    if (isLate && !assignment.allowLate) {
      return { ok: false, reason: "late_not_allowed" };
    }

    const existing = this.submissions.find(
      (s) =>
        s.tenantId === ctx.tenantId &&
        s.assignmentId === assignmentId &&
        s.userId === input.userId,
    );
    if (existing) {
      existing.body = input.body ?? null;
      existing.blobUrl = input.blobUrl ?? null;
      existing.status = "resubmitted";
      existing.submittedAt = now.toISOString();
      existing.isLate = isLate;
      return { ok: true, submission: existing, resubmitted: true };
    }

    const submission: SubmissionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      assignmentId,
      userId: input.userId,
      body: input.body ?? null,
      blobUrl: input.blobUrl ?? null,
      status: "submitted",
      submittedAt: now.toISOString(),
      isLate,
    };
    this.submissions.push(submission);
    return { ok: true, submission, resubmitted: false };
  }

  async listSubmissions(
    ctx: TenantContext,
    assignmentId: string,
  ): Promise<SubmissionRecord[]> {
    return this.submissions.filter(
      (s) => s.tenantId === ctx.tenantId && s.assignmentId === assignmentId,
    );
  }

  async getSubmission(
    ctx: TenantContext,
    id: string,
  ): Promise<SubmissionRecord | null> {
    return (
      this.submissions.find(
        (s) => s.id === id && s.tenantId === ctx.tenantId,
      ) ?? null
    );
  }

  async returnSubmission(
    ctx: TenantContext,
    id: string,
  ): Promise<SubmissionRecord | null> {
    const submission = this.submissions.find(
      (s) => s.id === id && s.tenantId === ctx.tenantId,
    );
    if (!submission) return null;
    submission.status = "returned";
    return submission;
  }
}

/** Build a MemoryAssignmentStore pre-seeded with a demo assignment. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryAssignmentStore {
  const store = new MemoryAssignmentStore(generateId, now);
  store.seedAssignment({
    id: "demo-assignment-1",
    tenantId: DEMO_TENANT_ID,
    courseId: "demo-course",
    title: "Essay 1",
    instructions: "Write 500 words.",
    dueAt: new Date("2026-12-31T23:59:00.000Z").toISOString(),
    points: 100,
    submissionType: "text",
    allowLate: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  });
  return store;
}
