import { TENANT_ID } from "./auth";

/**
 * Server-only client for the discussion microservice.
 *
 * This is the BFF read/write boundary for instructor course discussions:
 * every call forwards the authenticated tenant as `x-tenant-id`, so all data
 * stays tenant-scoped. A course IS an org unit, so forums are addressed by
 * `courseId`. Mutations return discriminated-union results rather than
 * throwing, so server actions can surface a clean error instead of a crashed
 * render when the service is down.
 */

export const DISCUSSION_SERVICE_URL =
  process.env.DISCUSSION_SERVICE_URL ?? "http://localhost:4010";

export interface Forum {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  position: number;
}

export interface Topic {
  id: string;
  tenantId: string;
  forumId: string;
  title: string;
  description: string | null;
}

export interface Post {
  id: string;
  tenantId: string;
  topicId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
}

export type ForumsResult =
  | { ok: true; forums: Forum[] }
  | { ok: false; error: string };

export type TopicsResult =
  | { ok: true; topics: Topic[] }
  | { ok: false; error: string };

export type PostsResult =
  | { ok: true; posts: Post[] }
  | { ok: false; error: string };

export type ForumResult =
  | { ok: true; forum: Forum }
  | { ok: false; error: string };

export type TopicResult =
  | { ok: true; topic: Topic }
  | { ok: false; error: string };

export type PostResult =
  | { ok: true; post: Post }
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
  "The discussion service is unreachable. Start it to manage discussions.";

export async function listForums(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<ForumsResult> {
  try {
    const url = `${DISCUSSION_SERVICE_URL}/forums?courseId=${encodeURIComponent(courseId)}`;
    const res = await fetch(url, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to load forums.") };
    }
    const data = (await res.json()) as { forums: Forum[] };
    return { ok: true, forums: data.forums };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function listTopics(
  forumId: string,
  tenantId: string = TENANT_ID,
): Promise<TopicsResult> {
  try {
    const res = await fetch(
      `${DISCUSSION_SERVICE_URL}/forums/${encodeURIComponent(forumId)}/topics`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to load topics.") };
    }
    const data = (await res.json()) as { topics: Topic[] };
    return { ok: true, topics: data.topics };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function listPosts(
  topicId: string,
  tenantId: string = TENANT_ID,
): Promise<PostsResult> {
  try {
    const res = await fetch(
      `${DISCUSSION_SERVICE_URL}/topics/${encodeURIComponent(topicId)}/posts`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to load posts.") };
    }
    const data = (await res.json()) as { posts: Post[] };
    return { ok: true, posts: data.posts };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function createForum(
  courseId: string,
  title: string,
  tenantId: string = TENANT_ID,
): Promise<ForumResult> {
  try {
    const res = await fetch(`${DISCUSSION_SERVICE_URL}/forums`, {
      method: "POST",
      headers: jsonHeaders(tenantId),
      body: JSON.stringify({ courseId, title }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to create forum.") };
    }
    const data = (await res.json()) as { forum: Forum };
    return { ok: true, forum: data.forum };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function createTopic(
  forumId: string,
  title: string,
  description: string | null,
  tenantId: string = TENANT_ID,
): Promise<TopicResult> {
  try {
    const res = await fetch(
      `${DISCUSSION_SERVICE_URL}/forums/${encodeURIComponent(forumId)}/topics`,
      {
        method: "POST",
        headers: jsonHeaders(tenantId),
        body: JSON.stringify({ title, description }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to create topic.") };
    }
    const data = (await res.json()) as { topic: Topic };
    return { ok: true, topic: data.topic };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function createPost(
  topicId: string,
  authorId: string,
  body: string,
  parentId: string | null,
  tenantId: string = TENANT_ID,
): Promise<PostResult> {
  try {
    const res = await fetch(
      `${DISCUSSION_SERVICE_URL}/topics/${encodeURIComponent(topicId)}/posts`,
      {
        method: "POST",
        headers: jsonHeaders(tenantId),
        body: JSON.stringify({ authorId, body, parentId }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to create post.") };
    }
    const data = (await res.json()) as { post: Post };
    return { ok: true, post: data.post };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function updatePost(
  postId: string,
  body: string,
  tenantId: string = TENANT_ID,
): Promise<PostResult> {
  try {
    const res = await fetch(
      `${DISCUSSION_SERVICE_URL}/posts/${encodeURIComponent(postId)}`,
      {
        method: "PATCH",
        headers: jsonHeaders(tenantId),
        body: JSON.stringify({ body }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to update post.") };
    }
    const data = (await res.json()) as { post: Post };
    return { ok: true, post: data.post };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function setPostPinned(
  postId: string,
  pinned: boolean,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(
      `${DISCUSSION_SERVICE_URL}/posts/${encodeURIComponent(postId)}/pin`,
      {
        method: "POST",
        headers: jsonHeaders(tenantId),
        body: JSON.stringify({ pinned }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to pin post.") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function deletePost(
  postId: string,
  tenantId: string = TENANT_ID,
): Promise<MutateResult> {
  try {
    const res = await fetch(
      `${DISCUSSION_SERVICE_URL}/posts/${encodeURIComponent(postId)}`,
      {
        method: "DELETE",
        headers: tenantHeader(tenantId),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Failed to delete post.") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
