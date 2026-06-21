import { TENANT_ID } from "./auth";

/**
 * Server-only client for the assignment microservice.
 *
 * This is the BFF read/write boundary for instructor assignment management:
 * every call forwards the authenticated tenant as `x-tenant-id` (the trusted
 * header the gateway injects in production and the assignment service's
 * resolver expects), so all data stays tenant-scoped. Mutations return
 * discriminated-union results rather than throwing, so server actions can
 * surface a clean error instead of a crashed render when the service is down.
 */

export const ASSIGNMENT_SERVICE_URL =
  process.env.ASSIGNMENT_SERVICE_URL ?? "http://localhost:4007";

export type SubmissionType = "file" | "text" | "url" | "none";

export interface Assignment {
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

export interface AssignmentInput {
  courseId: string;
  title: string;
  instructions?: string | null;
  dueAt?: string | null;
  points?: number;
  submissionType?: SubmissionType;
  allowLate?: boolean;
}

export type ListResult =
  | { ok: true; assignments: Assignment[] }
  | { ok: false; error: string };
export type AssignmentResult =
  | { ok: true; assignment: Assignment }
  | { ok: false; error: string };

export type MutateResult = { ok: true } | { ok: false; error: string };

function jsonHeaders(tenantId: string): HeadersInit {
  return { "content-type": "application/json", "x-tenant-id": tenantId };
}

/** Header set for bodyless requests — omitting content-type avoids Fastify's
 * empty-JSON-body rejection on DELETE that carries no payload. */
function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return data.message ?? fallback;
}

const UNREACHABLE =
  "The assignment service is unreachable. Start it to manage assignments.";

export async function listAssignments(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<ListResult> {
  try {
    const url = `${ASSIGNMENT_SERVICE_URL}/assignments?courseId=${encodeURIComponent(courseId)}`;
    const res = await fetch(url, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to load assignments."),
      };
    }
    const data = (await res.json()) as { assignments: Assignment[] };
    return { ok: true, assignments: data.assignments };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export interface Submission {
  id: string;
  tenantId: string;
  assignmentId: string;
  userId: string;
  body: string | null;
  blobUrl: string | null;
  status: string;
  submittedAt: string | null;
  isLate: boolean;
}

/** List submissions for an assignment. Returns `[]` on error. */
export async function listSubmissions(
  assignmentId: string,
  tenantId: string = TENANT_ID,
): Promise<Submission[]> {
  try {
    const res = await fetch(
      `${ASSIGNMENT_SERVICE_URL}/assignments/${encodeURIComponent(assignmentId)}/submissions`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { submissions: Submission[] };
    return data.submissions ?? [];
  } catch {
    return [];
  }
}

export async function getAssignment(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<AssignmentResult> {
  try {
    const res = await fetch(`${ASSIGNMENT_SERVICE_URL}/assignments/${id}`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Assignment not found.") };
    }
    const data = (await res.json()) as { assignment: Assignment };
    return { ok: true, assignment: data.assignment };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function createAssignment(
  input: AssignmentInput,
  tenantId: string = TENANT_ID,
): Promise<AssignmentResult> {
  try {
    const res = await fetch(`${ASSIGNMENT_SERVICE_URL}/assignments`, {
      method: "POST",
      headers: jsonHeaders(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to create assignment."),
      };
    }
    const data = (await res.json()) as { assignment: Assignment };
    return { ok: true, assignment: data.assignment };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function updateAssignment(
  id: string,
  input: Partial<Omit<AssignmentInput, "courseId">>,
  tenantId: string = TENANT_ID,
): Promise<AssignmentResult> {
  try {
    const res = await fetch(`${ASSIGNMENT_SERVICE_URL}/assignments/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to update assignment."),
      };
    }
    const data = (await res.json()) as { assignment: Assignment };
    return { ok: true, assignment: data.assignment };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function deleteAssignment(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(`${ASSIGNMENT_SERVICE_URL}/assignments/${id}`, {
      method: "DELETE",
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to delete assignment."),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
