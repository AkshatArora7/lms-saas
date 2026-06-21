import { TENANT_ID } from "./auth";

/**
 * Server-only client for the enrollment microservice.
 *
 * This is the BFF read/write boundary for instructor roster management: every
 * call forwards the authenticated tenant as `x-tenant-id`, so all data stays
 * tenant-scoped. A course IS a section (org unit), so the roster is addressed by
 * `courseId`. Mutations return discriminated-union results rather than throwing,
 * so server actions can surface a clean error instead of a crashed render when
 * the service is down.
 */

export const ENROLLMENT_SERVICE_URL =
  process.env.ENROLLMENT_SERVICE_URL ?? "http://localhost:4004";

export type EnrollmentStatus =
  | "active"
  | "inactive"
  | "completed"
  | "withdrawn";

export interface Enrollment {
  id: string;
  tenantId: string;
  userId: string;
  orgUnitId: string;
  role: string;
  status: EnrollmentStatus;
  enrolledAt: string;
}

/** Roles an instructor can assign from the roster console. */
export const ASSIGNABLE_ROLES = [
  "learner",
  "teaching_assistant",
  "instructor",
  "observer",
] as const;

export type RosterResult =
  | { ok: true; roster: Enrollment[] }
  | { ok: false; error: string };

export type EnrollmentResult =
  | { ok: true; enrollment: Enrollment }
  | { ok: false; error: string };

export type MutateResult = { ok: true } | { ok: false; error: string };

function jsonHeaders(tenantId: string): HeadersInit {
  return { "content-type": "application/json", "x-tenant-id": tenantId };
}

/** Header set for bodyless requests — omitting content-type avoids Fastify's
 * empty-JSON-body rejection on POST/DELETE that carry no payload. */
function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return data.message ?? fallback;
}

const UNREACHABLE =
  "The enrollment service is unreachable. Start it to manage the roster.";

export async function getRoster(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<RosterResult> {
  try {
    const url = `${ENROLLMENT_SERVICE_URL}/sections/${encodeURIComponent(courseId)}/roster`;
    const res = await fetch(url, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to load roster.") };
    }
    const data = (await res.json()) as { roster: Enrollment[] };
    return { ok: true, roster: data.roster };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/**
 * List a learner's own enrollments (the "my courses" join). Returns `[]` on
 * error so the dashboard renders a clean empty/offline state. Each enrollment's
 * `orgUnitId` is the course OFFERING the learner belongs to.
 */
export async function getUserEnrollments(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<Enrollment[]> {
  try {
    const url = `${ENROLLMENT_SERVICE_URL}/users/${encodeURIComponent(userId)}/enrollments`;
    const res = await fetch(url, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { enrollments: Enrollment[] };
    return data.enrollments ?? [];
  } catch {
    return [];
  }
}

export async function getEnrollment(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<EnrollmentResult> {
  try {
    const res = await fetch(`${ENROLLMENT_SERVICE_URL}/enrollments/${id}`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Enrollment not found.") };
    }
    const data = (await res.json()) as { enrollment: Enrollment };
    return { ok: true, enrollment: data.enrollment };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function enrollUser(
  input: { userId: string; orgUnitId: string; role: string },
  tenantId: string = TENANT_ID,
): Promise<EnrollmentResult> {
  try {
    const res = await fetch(`${ENROLLMENT_SERVICE_URL}/enrollments`, {
      method: "POST",
      headers: jsonHeaders(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to enroll user.") };
    }
    const data = (await res.json()) as { enrollment: Enrollment };
    return { ok: true, enrollment: data.enrollment };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function updateEnrollmentRole(
  id: string,
  role: string,
  tenantId: string = TENANT_ID,
): Promise<EnrollmentResult> {
  try {
    const res = await fetch(`${ENROLLMENT_SERVICE_URL}/enrollments/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(tenantId),
      body: JSON.stringify({ role }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to update role.") };
    }
    const data = (await res.json()) as { enrollment: Enrollment };
    return { ok: true, enrollment: data.enrollment };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function completeEnrollment(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(
      `${ENROLLMENT_SERVICE_URL}/enrollments/${id}/complete`,
      {
        method: "POST",
        headers: tenantHeader(tenantId),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to complete enrollment."),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function dropEnrollment(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(`${ENROLLMENT_SERVICE_URL}/enrollments/${id}`, {
      method: "DELETE",
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to drop enrollment."),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
