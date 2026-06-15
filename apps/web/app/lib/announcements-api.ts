import { TENANT_ID } from "./auth";

/**
 * Server-only client for the announcement microservice.
 *
 * This is the BFF read/write boundary for instructor course announcements:
 * every call forwards the authenticated tenant as `x-tenant-id`, so all data
 * stays tenant-scoped. A course IS an org unit, so announcements are addressed
 * by `courseId`. Mutations return discriminated-union results rather than
 * throwing, so server actions can surface a clean error instead of a crashed
 * render when the service is down.
 */

export const ANNOUNCEMENT_SERVICE_URL =
  process.env.ANNOUNCEMENT_SERVICE_URL ?? "http://localhost:4011";

export type AnnouncementStatus = "scheduled" | "published" | "expired";

export interface Announcement {
  id: string;
  tenantId: string;
  orgUnitId: string;
  authorId: string | null;
  title: string;
  body: string;
  publishAt: string;
  expiresAt: string | null;
  createdAt: string;
  status: AnnouncementStatus;
}

export interface NewAnnouncementInput {
  orgUnitId: string;
  title: string;
  body: string;
  publishAt?: string | null;
  expiresAt?: string | null;
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  publishAt?: string | null;
  expiresAt?: string | null;
}

export type ListResult =
  | { ok: true; announcements: Announcement[] }
  | { ok: false; error: string };

export type AnnouncementResult =
  | { ok: true; announcement: Announcement }
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
  "The announcement service is unreachable. Start it to manage announcements.";

export async function listCourseAnnouncements(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<ListResult> {
  try {
    const url = `${ANNOUNCEMENT_SERVICE_URL}/courses/${encodeURIComponent(courseId)}/announcements?include=all`;
    const res = await fetch(url, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to load announcements."),
      };
    }
    const data = (await res.json()) as { announcements: Announcement[] };
    return { ok: true, announcements: data.announcements };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function getAnnouncement(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<AnnouncementResult> {
  try {
    const res = await fetch(`${ANNOUNCEMENT_SERVICE_URL}/announcements/${id}`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Announcement not found."),
      };
    }
    const data = (await res.json()) as { announcement: Announcement };
    return { ok: true, announcement: data.announcement };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function createAnnouncement(
  input: NewAnnouncementInput,
  tenantId: string = TENANT_ID,
): Promise<AnnouncementResult> {
  try {
    const res = await fetch(`${ANNOUNCEMENT_SERVICE_URL}/announcements`, {
      method: "POST",
      headers: jsonHeaders(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to create announcement."),
      };
    }
    const data = (await res.json()) as { announcement: Announcement };
    return { ok: true, announcement: data.announcement };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function updateAnnouncement(
  id: string,
  input: UpdateAnnouncementInput,
  tenantId: string = TENANT_ID,
): Promise<AnnouncementResult> {
  try {
    const res = await fetch(`${ANNOUNCEMENT_SERVICE_URL}/announcements/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(tenantId),
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to update announcement."),
      };
    }
    const data = (await res.json()) as { announcement: Announcement };
    return { ok: true, announcement: data.announcement };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function publishAnnouncement(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(
      `${ANNOUNCEMENT_SERVICE_URL}/announcements/${id}/publish`,
      {
        method: "POST",
        headers: tenantHeader(tenantId),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to publish announcement."),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function deleteAnnouncement(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(`${ANNOUNCEMENT_SERVICE_URL}/announcements/${id}`, {
      method: "DELETE",
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res, "Failed to delete announcement."),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
