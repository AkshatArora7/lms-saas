import { TENANT_ID } from "./auth";
import { getEnrolledCourses } from "./enrolled";
import {
  listVisibleAnnouncements,
  type Announcement as AnnouncementRecord,
} from "./announcements-api";
import { getUser } from "./user-org-api";

/**
 * Announcements for the learner announcements / notifications inbox, sourced
 * live from the announcement microservice via the BFF server-fetch pattern
 * (tenant-scoped with `x-tenant-id`). We fan out across the learner's enrolled
 * course offerings and resolve author display names from user-org. Returns `[]`
 * (driving the empty state) when there is nothing to show or a service is
 * unreachable — no demo fallback.
 */

export type AnnouncementScope = "school" | "course";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  scope: AnnouncementScope;
  /** Display name of the source: the school or a specific course. */
  source: string;
  author: string;
  /** ISO timestamp the announcement was posted. */
  postedAt: string;
  unread: boolean;
}

export interface AnnouncementsSummary {
  total: number;
  unread: number;
}

function byNewest(a: Announcement, b: Announcement): number {
  return b.postedAt.localeCompare(a.postedAt);
}

/**
 * Resolve the learner's announcements across enrolled course offerings, newest
 * first, with author display names resolved from user-org.
 */
export async function getAnnouncements(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<Announcement[]> {
  const enrolled = await getEnrolledCourses(userId, tenantId);
  const perCourse = await Promise.all(
    enrolled.map(async (course) => {
      const records = await listVisibleAnnouncements(course.orgUnitId, tenantId);
      return records.map((record) => ({ record, course }));
    }),
  );
  const flat = perCourse.flat();

  // Resolve author display names once per distinct author.
  const authorIds = Array.from(
    new Set(
      flat
        .map(({ record }) => record.authorId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const authorEntries = await Promise.all(
    authorIds.map(async (id) => {
      const user = await getUser(id, tenantId);
      return [id, user?.displayName ?? "Staff"] as const;
    }),
  );
  const authorNames = new Map(authorEntries);

  return flat
    .map(({ record, course }): Announcement =>
      mapAnnouncement(record, course.title, authorNames),
    )
    .sort(byNewest);
}

function mapAnnouncement(
  record: AnnouncementRecord,
  courseTitle: string,
  authorNames: Map<string, string>,
): Announcement {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    // Announcements in this surface are scoped to a course offering; a future
    // school-wide root org unit would map to "school".
    scope: "course",
    source: courseTitle,
    author: record.authorId
      ? authorNames.get(record.authorId) ?? "Staff"
      : "Staff",
    postedAt: record.publishAt,
    // No per-user read state is modelled yet, so nothing is marked unread.
    unread: false,
  };
}

/** Summarise total and unread counts. */
export function summarizeAnnouncements(
  announcements: Announcement[],
): AnnouncementsSummary {
  return {
    total: announcements.length,
    unread: announcements.filter((a) => a.unread).length,
  };
}

/**
 * Format an ISO timestamp as a coarse relative string ("2h ago", "3d ago").
 * Deterministic given `now`; defaults to the current time.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (Number.isNaN(then) || diffMs < 0) {
    return "just now";
  }
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
