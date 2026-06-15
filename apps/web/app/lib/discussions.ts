import { TENANT_ID } from "./auth";

/**
 * Discussion threads for the learner course discussions screen.
 *
 * In production these come from the discussion service, scoped to a course and
 * tenant via the gateway. Until that read path is wired in, we resolve a small,
 * deterministic set of threads for known demo courses and an empty list
 * otherwise, so the screen renders a real happy path and a real empty state
 * with no backend dependency.
 */

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

export interface DiscussionThread {
  id: string;
  title: string;
  author: string;
  replies: number;
  /** ISO timestamp of the most recent activity. */
  lastActivityAt: string;
  pinned: boolean;
  /** True when the thread has no replies and is awaiting a response. */
  unanswered: boolean;
}

export interface DiscussionsSummary {
  total: number;
  unanswered: number;
}

const DEMO_THREADS_BY_COURSE: Record<string, DiscussionThread[]> = {
  "alg-101": [
    {
      id: "alg-101-t0",
      title: "Read this first: discussion etiquette",
      author: "Dr. Priya Natarajan",
      replies: 0,
      lastActivityAt: "2026-06-01T09:00:00Z",
      pinned: true,
      unanswered: false,
    },
    {
      id: "alg-101-t1",
      title: "Stuck on multi-step equations — when do I flip the sign?",
      author: "Jordan M.",
      replies: 4,
      lastActivityAt: "2026-06-15T07:45:00Z",
      pinned: false,
      unanswered: false,
    },
    {
      id: "alg-101-t2",
      title: "Is the quiz cumulative or just module 2?",
      author: "Sam R.",
      replies: 0,
      lastActivityAt: "2026-06-14T18:20:00Z",
      pinned: false,
      unanswered: true,
    },
    {
      id: "alg-101-t3",
      title: "Study group for the linear equations quiz?",
      author: "Avery T.",
      replies: 7,
      lastActivityAt: "2026-06-13T21:10:00Z",
      pinned: false,
      unanswered: false,
    },
  ],
  "bio-110": [
    {
      id: "bio-110-t1",
      title: "Field trip logistics — carpool thread",
      author: "Mr. Osei",
      replies: 9,
      lastActivityAt: "2026-06-15T06:30:00Z",
      pinned: true,
      unanswered: false,
    },
    {
      id: "bio-110-t2",
      title: "Difference between mitosis and meiosis?",
      author: "Riley P.",
      replies: 2,
      lastActivityAt: "2026-06-12T15:00:00Z",
      pinned: false,
      unanswered: false,
    },
    {
      id: "bio-110-t3",
      title: "Lab report formatting question",
      author: "Casey L.",
      replies: 0,
      lastActivityAt: "2026-06-11T11:25:00Z",
      pinned: false,
      unanswered: true,
    },
  ],
};

function compareThreads(a: DiscussionThread, b: DiscussionThread): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  return b.lastActivityAt.localeCompare(a.lastActivityAt);
}

/**
 * Resolve the discussion threads for a course, pinned first then by most recent
 * activity. Returns an empty list for unknown courses or non-demo tenants.
 */
export function getCourseDiscussions(
  courseId: string,
  tenantId: string = TENANT_ID,
): DiscussionThread[] {
  if (tenantId !== DEMO_TENANT_ID) {
    return [];
  }
  const threads = DEMO_THREADS_BY_COURSE[courseId];
  return threads ? [...threads].sort(compareThreads) : [];
}

/** Summarise total and unanswered thread counts. */
export function summarizeDiscussions(
  threads: DiscussionThread[],
): DiscussionsSummary {
  return {
    total: threads.length,
    unanswered: threads.filter((thread) => thread.unanswered).length,
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
