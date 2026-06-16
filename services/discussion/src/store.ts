import type { TenantContext } from "@lms/types";

/** A course-scoped forum that groups discussion topics. */
export interface ForumRecord {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  position: number;
}

/** A thread of conversation within a forum. */
export interface TopicRecord {
  id: string;
  tenantId: string;
  forumId: string;
  title: string;
  description: string | null;
}

/** A post in a topic; `parentId` makes the thread tree. */
export interface PostRecord {
  id: string;
  tenantId: string;
  topicId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
}

/** A post with its nested replies (threaded view). */
export interface ThreadNode extends PostRecord {
  replies: ThreadNode[];
}

/** Per-author post count, for graded participation. */
export interface ParticipationRow {
  authorId: string;
  posts: number;
}

export interface NewForumInput {
  courseId: string;
  title: string;
  position?: number;
}

export interface NewTopicInput {
  title: string;
  description?: string | null;
}

export interface NewPostInput {
  authorId: string;
  body: string;
  parentId?: string | null;
}

export type CreatePostResult =
  | { ok: true; post: PostRecord }
  | { ok: false; reason: "unknown_topic" | "unknown_parent" };

/**
 * Persistence boundary for the discussion service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the other domain services.
 */
export interface DiscussionStore {
  createForum(ctx: TenantContext, input: NewForumInput): Promise<ForumRecord>;
  listForums(ctx: TenantContext, courseId: string): Promise<ForumRecord[]>;

  /** Create a topic in a forum; null when the forum does not exist. */
  createTopic(
    ctx: TenantContext,
    forumId: string,
    input: NewTopicInput,
  ): Promise<TopicRecord | null>;
  listTopics(ctx: TenantContext, forumId: string): Promise<TopicRecord[]>;

  /** Add a post/reply to a topic; rejects unknown topic or parent. */
  createPost(
    ctx: TenantContext,
    topicId: string,
    input: NewPostInput,
  ): Promise<CreatePostResult>;

  /** Flat list of a topic's posts (pinned first, then chronological). */
  listPosts(ctx: TenantContext, topicId: string): Promise<PostRecord[]>;

  /** Threaded view of a topic's posts as a reply tree. */
  getThread(ctx: TenantContext, topicId: string): Promise<ThreadNode[]>;

  /** Moderation: pin or unpin a post. */
  setPinned(
    ctx: TenantContext,
    postId: string,
    pinned: boolean,
  ): Promise<PostRecord | null>;

  /** Edit a post's body; null when the post does not exist for this tenant. */
  updatePost(
    ctx: TenantContext,
    postId: string,
    body: string,
  ): Promise<PostRecord | null>;

  /** Moderation: delete a post (and, by cascade, its replies). */
  deletePost(ctx: TenantContext, postId: string): Promise<boolean>;

  /** Graded participation: post counts per author across a forum's topics. */
  participation(
    ctx: TenantContext,
    forumId: string,
  ): Promise<ParticipationRow[]>;
}

/** Build a threaded tree from a flat, ordered list of posts. */
export function buildThread(posts: PostRecord[]): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>();
  for (const post of posts) {
    nodes.set(post.id, { ...post, replies: [] });
  }
  const roots: ThreadNode[] = [];
  for (const post of posts) {
    const node = nodes.get(post.id)!;
    if (post.parentId && nodes.has(post.parentId)) {
      nodes.get(post.parentId)!.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
