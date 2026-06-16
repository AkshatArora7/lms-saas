import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  buildThread,
  type CreatePostResult,
  type DiscussionStore,
  type ForumRecord,
  type NewForumInput,
  type NewPostInput,
  type NewTopicInput,
  type ParticipationRow,
  type PostRecord,
  type ThreadNode,
  type TopicRecord,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory DiscussionStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `DISCUSSION_STORE=memory`.
 */
export class MemoryDiscussionStore implements DiscussionStore {
  private forums: ForumRecord[] = [];
  private topics: TopicRecord[] = [];
  private posts: PostRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  seedForum(forum: ForumRecord): void {
    this.forums.push(forum);
  }
  seedTopic(topic: TopicRecord): void {
    this.topics.push(topic);
  }
  seedPost(post: PostRecord): void {
    this.posts.push(post);
  }

  async createForum(
    ctx: TenantContext,
    input: NewForumInput,
  ): Promise<ForumRecord> {
    const forum: ForumRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId: input.courseId,
      title: input.title,
      position:
        input.position ??
        this.forums.filter(
          (f) => f.tenantId === ctx.tenantId && f.courseId === input.courseId,
        ).length,
    };
    this.forums.push(forum);
    return forum;
  }

  async listForums(
    ctx: TenantContext,
    courseId: string,
  ): Promise<ForumRecord[]> {
    return this.forums
      .filter((f) => f.tenantId === ctx.tenantId && f.courseId === courseId)
      .sort((a, b) => a.position - b.position);
  }

  async createTopic(
    ctx: TenantContext,
    forumId: string,
    input: NewTopicInput,
  ): Promise<TopicRecord | null> {
    const forum = this.forums.find(
      (f) => f.id === forumId && f.tenantId === ctx.tenantId,
    );
    if (!forum) return null;
    const topic: TopicRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      forumId,
      title: input.title,
      description: input.description ?? null,
    };
    this.topics.push(topic);
    return topic;
  }

  async listTopics(
    ctx: TenantContext,
    forumId: string,
  ): Promise<TopicRecord[]> {
    return this.topics.filter(
      (t) => t.tenantId === ctx.tenantId && t.forumId === forumId,
    );
  }

  async createPost(
    ctx: TenantContext,
    topicId: string,
    input: NewPostInput,
  ): Promise<CreatePostResult> {
    const topic = this.topics.find(
      (t) => t.id === topicId && t.tenantId === ctx.tenantId,
    );
    if (!topic) return { ok: false, reason: "unknown_topic" };

    if (input.parentId) {
      const parent = this.posts.find(
        (p) =>
          p.id === input.parentId &&
          p.tenantId === ctx.tenantId &&
          p.topicId === topicId,
      );
      if (!parent) return { ok: false, reason: "unknown_parent" };
    }

    const post: PostRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      topicId,
      parentId: input.parentId ?? null,
      authorId: input.authorId,
      body: input.body,
      isPinned: false,
      createdAt: this.now().toISOString(),
    };
    this.posts.push(post);
    return { ok: true, post };
  }

  private orderedPosts(ctx: TenantContext, topicId: string): PostRecord[] {
    return this.posts
      .filter((p) => p.tenantId === ctx.tenantId && p.topicId === topicId)
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async listPosts(
    ctx: TenantContext,
    topicId: string,
  ): Promise<PostRecord[]> {
    return this.orderedPosts(ctx, topicId);
  }

  async getThread(
    ctx: TenantContext,
    topicId: string,
  ): Promise<ThreadNode[]> {
    // Order chronologically so reply nesting is stable; pins surface in lists.
    const chronological = this.posts
      .filter((p) => p.tenantId === ctx.tenantId && p.topicId === topicId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return buildThread(chronological);
  }

  async setPinned(
    ctx: TenantContext,
    postId: string,
    pinned: boolean,
  ): Promise<PostRecord | null> {
    const post = this.posts.find(
      (p) => p.id === postId && p.tenantId === ctx.tenantId,
    );
    if (!post) return null;
    post.isPinned = pinned;
    return post;
  }

  async updatePost(
    ctx: TenantContext,
    postId: string,
    body: string,
  ): Promise<PostRecord | null> {
    const post = this.posts.find(
      (p) => p.id === postId && p.tenantId === ctx.tenantId,
    );
    if (!post) return null;
    post.body = body;
    return post;
  }

  async deletePost(ctx: TenantContext, postId: string): Promise<boolean> {
    const exists = this.posts.some(
      (p) => p.id === postId && p.tenantId === ctx.tenantId,
    );
    if (!exists) return false;
    // Cascade: remove the post and any descendants.
    const toRemove = new Set<string>([postId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.posts) {
        if (p.parentId && toRemove.has(p.parentId) && !toRemove.has(p.id)) {
          toRemove.add(p.id);
          changed = true;
        }
      }
    }
    this.posts = this.posts.filter(
      (p) => !(p.tenantId === ctx.tenantId && toRemove.has(p.id)),
    );
    return true;
  }

  async participation(
    ctx: TenantContext,
    forumId: string,
  ): Promise<ParticipationRow[]> {
    const topicIds = new Set(
      this.topics
        .filter((t) => t.tenantId === ctx.tenantId && t.forumId === forumId)
        .map((t) => t.id),
    );
    const counts = new Map<string, number>();
    for (const post of this.posts) {
      if (post.tenantId === ctx.tenantId && topicIds.has(post.topicId)) {
        counts.set(post.authorId, (counts.get(post.authorId) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([authorId, posts]) => ({ authorId, posts }))
      .sort((a, b) => b.posts - a.posts || a.authorId.localeCompare(b.authorId));
  }
}

/** Build a MemoryDiscussionStore pre-seeded with a demo forum + topic. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryDiscussionStore {
  const store = new MemoryDiscussionStore(generateId, now);
  store.seedForum({
    id: "demo-forum-1",
    tenantId: DEMO_TENANT_ID,
    courseId: "demo-course",
    title: "General",
    position: 0,
  });
  store.seedTopic({
    id: "demo-topic-1",
    tenantId: DEMO_TENANT_ID,
    forumId: "demo-forum-1",
    title: "Welcome",
    description: "Introduce yourself.",
  });

  // Seed a forum/topic/posts under the demo taught course (alg-101) so the
  // teacher web discussions screens have content to manage out of the box.
  store.seedForum({
    id: "demo-alg-forum-1",
    tenantId: DEMO_TENANT_ID,
    courseId: "alg-101",
    title: "Q&A",
    position: 0,
  });
  store.seedTopic({
    id: "demo-alg-topic-1",
    tenantId: DEMO_TENANT_ID,
    forumId: "demo-alg-forum-1",
    title: "Week 1: Linear equations",
    description: "Ask anything about this week's material.",
  });
  store.seedPost({
    id: "demo-alg-post-1",
    tenantId: DEMO_TENANT_ID,
    topicId: "demo-alg-topic-1",
    parentId: null,
    authorId: "ada.lovelace",
    body: "Is question 3 on the homework graded?",
    isPinned: false,
    createdAt: "2026-01-05T09:00:00.000Z",
  });
  store.seedPost({
    id: "demo-alg-post-2",
    tenantId: DEMO_TENANT_ID,
    topicId: "demo-alg-topic-1",
    parentId: "demo-alg-post-1",
    authorId: "grace.hopper",
    body: "Yes, it counts toward participation.",
    isPinned: false,
    createdAt: "2026-01-05T10:30:00.000Z",
  });
  return store;
}
