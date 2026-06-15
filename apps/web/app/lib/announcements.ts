import { TENANT_ID } from "./auth";

/**
 * Announcements for the learner announcements / notifications inbox.
 *
 * In production these come from a notifications/announcements service, fanned
 * out from school-wide and per-course posts and tenant-scoped via the gateway.
 * Until that read path is wired in, we resolve a small, deterministic set for
 * the seeded demo tenant and an empty collection for everyone else, so the
 * screen renders a real happy path and a real empty state with no backend.
 */

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

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

const DEMO_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "ann-1",
    title: "Midterm schedule published",
    body: "Midterm exams run the week of the 24th. Check your schedule for room assignments and bring your student ID.",
    scope: "school",
    source: "Northwind Academy",
    author: "Registrar's Office",
    postedAt: "2026-06-15T08:30:00Z",
    unread: true,
  },
  {
    id: "ann-2",
    title: "Lab 4 due date extended",
    body: "Because of the network outage on Tuesday, Lab 4 is now due Friday at 11:59 PM. No late penalty for submissions before then.",
    scope: "course",
    source: "Intro to Computer Science (CS-101)",
    author: "Dr. Park",
    postedAt: "2026-06-14T16:05:00Z",
    unread: true,
  },
  {
    id: "ann-3",
    title: "Reading for next week",
    body: "Please read chapters 5 and 6 before Monday's class. We'll start the seminar discussion right away.",
    scope: "course",
    source: "English Literature (ENG-150)",
    author: "Mrs. Nguyen",
    postedAt: "2026-06-13T12:00:00Z",
    unread: false,
  },
  {
    id: "ann-4",
    title: "Library hours extended for finals",
    body: "The library will be open until midnight starting next week to support exam preparation.",
    scope: "school",
    source: "Northwind Academy",
    author: "Library Services",
    postedAt: "2026-06-11T09:15:00Z",
    unread: false,
  },
  {
    id: "ann-5",
    title: "Field trip permission slips",
    body: "Permission slips for the Biology field trip are due by the end of the week. See Mr. Osei with any questions.",
    scope: "course",
    source: "Biology (SCI-110)",
    author: "Mr. Osei",
    postedAt: "2026-06-10T14:40:00Z",
    unread: false,
  },
];

function byNewest(a: Announcement, b: Announcement): number {
  return b.postedAt.localeCompare(a.postedAt);
}

/** Resolve the learner's announcements for the current tenant, newest first. */
export function getAnnouncements(
  tenantId: string = TENANT_ID,
): Announcement[] {
  if (tenantId !== DEMO_TENANT_ID) {
    return [];
  }
  return [...DEMO_ANNOUNCEMENTS].sort(byNewest);
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
