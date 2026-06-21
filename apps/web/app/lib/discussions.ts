import { TENANT_ID } from "./auth";
import { listForums, listTopics, listPosts } from "./discussions-api";
import { getUser } from "./user-org-api";

/**
 * Discussion threads for the learner course discussions screen, sourced live
 * from the discussion microservice via the BFF server-fetch pattern
 * (tenant-scoped with `x-tenant-id`). A course's forums → topics → posts are
 * collapsed into a flat thread list (one thread per topic). Returns `[]`
 * (driving the empty state) when there are no threads or a service is
 * unreachable — no demo fallback.
 */

export interface DiscussionThread {
  id: string;
  title: string;
  excerpt: string;
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

function compareThreads(a: DiscussionThread, b: DiscussionThread): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  return b.lastActivityAt.localeCompare(a.lastActivityAt);
}

/**
 * Resolve the discussion threads for a course (keyed by the course id), pinned
 * first then by most recent activity. Author display names are resolved from
 * user-org. Returns `[]` for courses with no discussion or when a service is
 * unreachable.
 */
export async function getCourseDiscussions(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<DiscussionThread[]> {
  const forumsResult = await listForums(courseId, tenantId);
  if (!forumsResult.ok || !forumsResult.forums.length) return [];

  const topicLists = await Promise.all(
    forumsResult.forums.map(async (forum) => {
      const topicsResult = await listTopics(forum.id, tenantId);
      return topicsResult.ok ? topicsResult.topics : [];
    }),
  );
  const topics = topicLists.flat();
  if (!topics.length) return [];

  const threads = await Promise.all(
    topics.map(async (topic): Promise<DiscussionThread | null> => {
      const postsResult = await listPosts(topic.id, tenantId);
      const posts = postsResult.ok ? postsResult.posts : [];
      const roots = posts.filter((p) => p.parentId === null);
      const replies = posts.length - roots.length;
      const root = roots[0];
      const lastActivityAt = posts.reduce(
        (latest, p) => (p.createdAt > latest ? p.createdAt : latest),
        root?.createdAt ?? "",
      );
      const authorId = root?.authorId;
      const author = authorId
        ? (await getUser(authorId, tenantId))?.displayName ?? "Member"
        : "Member";
      return {
        id: topic.id,
        title: topic.title,
        excerpt: root?.body ?? topic.description ?? "",
        author,
        replies,
        lastActivityAt,
        pinned: roots.some((p) => p.isPinned),
        unanswered: replies === 0,
      };
    }),
  );

  return threads
    .filter((t): t is DiscussionThread => t !== null)
    .sort(compareThreads);
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
