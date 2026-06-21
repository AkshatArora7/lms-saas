import { withTenant } from "@lms/db";

import type {
  AssignmentRecord,
  AssignmentStore,
  NewAssignmentInput,
  NewSubmissionInput,
  SubmissionRecord,
  SubmissionStatus,
  SubmissionType,
  SubmitResult,
  UpdateAssignmentInput,
} from "./store.js";

interface AssignmentRow {
  id: string;
  tenant_id: string;
  course_id: string;
  title: string;
  instructions: string | null;
  due_at: Date | string | null;
  points: number | string;
  submission_type: SubmissionType;
  allow_late: boolean;
  created_at: Date | string;
}

interface SubmissionRow {
  id: string;
  tenant_id: string;
  assignment_id: string;
  user_id: string;
  body: string | null;
  blob_url: string | null;
  status: SubmissionStatus;
  submitted_at: Date | string;
  is_late: boolean;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAssignment(row: AssignmentRow): AssignmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    courseId: row.course_id,
    title: row.title,
    instructions: row.instructions,
    dueAt: iso(row.due_at),
    points: typeof row.points === "number" ? row.points : Number(row.points),
    submissionType: row.submission_type,
    allowLate: row.allow_late,
    createdAt: iso(row.created_at) ?? "",
  };
}

function toSubmission(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assignmentId: row.assignment_id,
    userId: row.user_id,
    body: row.body,
    blobUrl: row.blob_url,
    status: row.status,
    submittedAt: iso(row.submitted_at) ?? "",
    isLate: row.is_late,
  };
}

const SELECT_ASSIGNMENT = `
  SELECT id, tenant_id, course_id, title, instructions, due_at, points,
         submission_type, allow_late, created_at
    FROM assignment`;

const SELECT_SUBMISSION = `
  SELECT id, tenant_id, assignment_id, user_id, body, blob_url, status,
         submitted_at, is_late
    FROM submission`;

/**
 * Postgres-backed assignment store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants.
 */
export function createPrismaStore(): AssignmentStore {
  return {
    async createAssignment(ctx, input: NewAssignmentInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AssignmentRow[]>(
          `INSERT INTO assignment
             (tenant_id, course_id, title, instructions, due_at, points,
              submission_type, allow_late)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
           RETURNING id, tenant_id, course_id, title, instructions, due_at,
                     points, submission_type, allow_late, created_at`,
          ctx.tenantId,
          input.courseId,
          input.title,
          input.instructions ?? null,
          input.dueAt ?? null,
          input.points ?? 100,
          input.submissionType ?? "file",
          input.allowLate ?? true,
        );
        return toAssignment(rows[0]!);
      });
    },

    async getAssignment(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AssignmentRow[]>(
          `${SELECT_ASSIGNMENT} WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toAssignment(rows[0]) : null;
      });
    },

    async listAssignments(ctx, courseId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AssignmentRow[]>(
          `${SELECT_ASSIGNMENT} WHERE course_id = $1::uuid ORDER BY created_at`,
          courseId,
        );
        return rows.map(toAssignment);
      });
    },

    async updateAssignment(ctx, id, input: UpdateAssignmentInput) {
      return withTenant(ctx, async (db) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        const push = (column: string, value: unknown): void => {
          params.push(value);
          sets.push(`${column} = $${params.length}`);
        };
        if (input.title !== undefined) push("title", input.title);
        if (input.instructions !== undefined)
          push("instructions", input.instructions);
        if (input.dueAt !== undefined) push("due_at", input.dueAt);
        if (input.points !== undefined) push("points", input.points);
        if (input.submissionType !== undefined)
          push("submission_type", input.submissionType);
        if (input.allowLate !== undefined) push("allow_late", input.allowLate);

        if (sets.length === 0) {
          const rows = await db.$queryRawUnsafe<AssignmentRow[]>(
            `${SELECT_ASSIGNMENT} WHERE id = $1::uuid LIMIT 1`,
            id,
          );
          return rows[0] ? toAssignment(rows[0]) : null;
        }

        params.push(id);
        const rows = await db.$queryRawUnsafe<AssignmentRow[]>(
          `UPDATE assignment SET ${sets.join(", ")}
            WHERE id = $${params.length}::uuid
          RETURNING id, tenant_id, course_id, title, instructions, due_at,
                    points, submission_type, allow_late, created_at`,
          ...params,
        );
        return rows[0] ? toAssignment(rows[0]) : null;
      });
    },

    async deleteAssignment(ctx, id) {
      return withTenant(ctx, async (db) => {
        const affected = await db.$executeRawUnsafe(
          `DELETE FROM assignment WHERE id = $1::uuid`,
          id,
        );
        return affected > 0;
      });
    },

    async submit(ctx, assignmentId, input: NewSubmissionInput) {
      return withTenant<SubmitResult>(ctx, async (db) => {
        const assignmentRows = await db.$queryRawUnsafe<
          { due_at: Date | string | null; allow_late: boolean }[]
        >(
          `SELECT due_at, allow_late FROM assignment WHERE id = $1::uuid LIMIT 1`,
          assignmentId,
        );
        const assignment = assignmentRows[0];
        if (!assignment) return { ok: false, reason: "unknown_assignment" };

        const due = assignment.due_at ? new Date(iso(assignment.due_at)!) : null;
        const isLate = due !== null && new Date() > due;
        if (isLate && !assignment.allow_late) {
          return { ok: false, reason: "late_not_allowed" };
        }

        const rows = await db.$queryRawUnsafe<
          (SubmissionRow & { was_update: boolean })[]
        >(
          `INSERT INTO submission
             (tenant_id, assignment_id, user_id, body, blob_url, status,
              submitted_at, is_late)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'submitted', now(), $6)
           ON CONFLICT (assignment_id, user_id) DO UPDATE SET
             body = EXCLUDED.body,
             blob_url = EXCLUDED.blob_url,
             status = 'resubmitted',
             submitted_at = now(),
             is_late = EXCLUDED.is_late
           RETURNING id, tenant_id, assignment_id, user_id, body, blob_url,
                     status, submitted_at, is_late,
                     (xmax <> 0) AS was_update`,
          ctx.tenantId,
          assignmentId,
          input.userId,
          input.body ?? null,
          input.blobUrl ?? null,
          isLate,
        );
        const row = rows[0]!;
        return {
          ok: true,
          submission: toSubmission(row),
          resubmitted: row.was_update,
        };
      });
    },

    async listSubmissions(ctx, assignmentId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<SubmissionRow[]>(
          `${SELECT_SUBMISSION} WHERE assignment_id = $1::uuid ORDER BY submitted_at`,
          assignmentId,
        );
        return rows.map(toSubmission);
      });
    },

    async getSubmission(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<SubmissionRow[]>(
          `${SELECT_SUBMISSION} WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toSubmission(rows[0]) : null;
      });
    },

    async returnSubmission(ctx, id) {
      return withTenant(ctx, async (db) => {
        const updated = await db.$executeRawUnsafe(
          `UPDATE submission SET status = 'returned' WHERE id = $1::uuid`,
          id,
        );
        if (updated === 0) return null;
        const rows = await db.$queryRawUnsafe<SubmissionRow[]>(
          `${SELECT_SUBMISSION} WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toSubmission(rows[0]) : null;
      });
    },
  };
}
