import { TENANT_ID } from "./auth";

/**
 * Server-only client for the course microservice.
 *
 * This is the BFF read boundary for the learner's course catalogue: every call
 * forwards the authenticated tenant as `x-tenant-id` (the trusted header the
 * gateway injects in production and the course service's resolver expects), so
 * all data stays tenant-scoped. Reads return `[]` / `null` on failure so the
 * Server Component renders a clean empty/offline state instead of crashing.
 *
 * Note on identifiers: a course row (`id`) is backed by an org unit / course
 * offering (`orgUnitId`). Enrollments, announcements and timetables are keyed by
 * the OFFERING (`orgUnitId`), while assignments, discussions and grades are
 * keyed by the COURSE (`id`). Callers resolve between the two via `orgUnitId`.
 */

export const COURSE_SERVICE_URL =
  process.env.COURSE_SERVICE_URL ?? "http://localhost:4005";

export interface Course {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  startDate: string | null;
  endDate: string | null;
  orgUnitId: string;
  templateId: string | null;
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/** List every course visible to the tenant. Returns `[]` on error. */
export async function listCourses(
  tenantId: string = TENANT_ID,
): Promise<Course[]> {
  try {
    const res = await fetch(`${COURSE_SERVICE_URL}/courses`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { courses: Course[] };
    return data.courses ?? [];
  } catch {
    return [];
  }
}

/** Fetch a single course by id. Returns `null` when missing or unreachable. */
export async function getCourse(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<Course | null> {
  try {
    const res = await fetch(
      `${COURSE_SERVICE_URL}/courses/${encodeURIComponent(id)}`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { course: Course };
    return data.course ?? null;
  } catch {
    return null;
  }
}
