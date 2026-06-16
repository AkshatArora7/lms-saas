import { TENANT_ID } from "./auth";

/**
 * Server-only client for the course microservice.
 *
 * This is the BFF read/write boundary for the admin console: every call
 * forwards the authenticated tenant as `x-tenant-id` (the trusted header the
 * gateway injects in production and the course service's resolver expects), so
 * all course data stays tenant-scoped. Mutations return discriminated-union
 * results rather than throwing, so server actions can surface a clean error
 * message instead of a crashed render when the service is unreachable.
 */

export const COURSE_SERVICE_URL =
  process.env.COURSE_SERVICE_URL ?? "http://localhost:4005";

export interface Course {
  id: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface CourseInput {
  title: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export type ListResult =
  | { ok: true; courses: Course[] }
  | { ok: false; error: string };

export type CourseResult =
  | { ok: true; course: Course }
  | { ok: false; error: string };

export type MutateResult = { ok: true } | { ok: false; error: string };

function headers(tenantId: string): HeadersInit {
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

/** List every course for the tenant, newest backend ordering preserved. */
export async function listCourses(
  tenantId: string = TENANT_ID,
): Promise<ListResult> {
  try {
    const res = await fetch(`${COURSE_SERVICE_URL}/courses`, {
      headers: headers(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to load courses.") };
    }
    const data = (await res.json()) as { courses: Course[] };
    return { ok: true, courses: data.courses };
  } catch {
    return {
      ok: false,
      error: "The course service is unreachable. Start it to manage courses.",
    };
  }
}

/** Fetch a single course, or an error result if it does not exist. */
export async function getCourse(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<CourseResult> {
  try {
    const res = await fetch(`${COURSE_SERVICE_URL}/courses/${id}`, {
      headers: headers(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Course not found.") };
    }
    const data = (await res.json()) as { course: Course };
    return { ok: true, course: data.course };
  } catch {
    return { ok: false, error: "The course service is unreachable." };
  }
}

export async function createCourse(
  input: CourseInput,
  tenantId: string = TENANT_ID,
): Promise<CourseResult> {
  try {
    const res = await fetch(`${COURSE_SERVICE_URL}/courses`, {
      method: "POST",
      headers: headers(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to create course.") };
    }
    const data = (await res.json()) as { course: Course };
    return { ok: true, course: data.course };
  } catch {
    return { ok: false, error: "The course service is unreachable." };
  }
}

export async function updateCourse(
  id: string,
  input: Partial<CourseInput>,
  tenantId: string = TENANT_ID,
): Promise<CourseResult> {
  try {
    const res = await fetch(`${COURSE_SERVICE_URL}/courses/${id}`, {
      method: "PATCH",
      headers: headers(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to update course.") };
    }
    const data = (await res.json()) as { course: Course };
    return { ok: true, course: data.course };
  } catch {
    return { ok: false, error: "The course service is unreachable." };
  }
}

export async function publishCourse(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<CourseResult> {
  try {
    const res = await fetch(`${COURSE_SERVICE_URL}/courses/${id}/publish`, {
      method: "POST",
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to publish course.") };
    }
    const data = (await res.json()) as { course: Course };
    return { ok: true, course: data.course };
  } catch {
    return { ok: false, error: "The course service is unreachable." };
  }
}

export async function deleteCourse(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(`${COURSE_SERVICE_URL}/courses/${id}`, {
      method: "DELETE",
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to delete course.") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "The course service is unreachable." };
  }
}
