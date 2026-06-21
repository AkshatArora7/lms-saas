import { withTenant } from "@lms/db";

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

interface ForumRow {
  id: string;
  tenant_id: string;
  course_id: string;
  title: string;
  position: number;
}
interface TopicRow {
  id: string;
  tenant_id: string;
  forum_id: string;
  title: string;
  description: string | null;
}
interface PostRow {
  id: string;
  tenant_id: string;
  topic_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  is_pinned: boolean;
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toForum(r: ForumRow): ForumRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    courseId: r.course_id,
    title: r.title,
    position: r.position,
  };
}
function toTopic(r: TopicRow): TopicRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    forumId: r.forum_id,
    title: r.title,
    description: r.description,
  };
}
function toPost(r: PostRow): PostRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    topicId: r.topic_id,
    parentId: r.parent_id,
    authorId: r.author_id,
    body: r.body,
    isPinned: r.is_pinned,
    createdAt: iso(r.created_at),
  };
}

const SELECT_POST = `
  SELECT id, tenant_id, topic_id, parent_id, author_id, body, is_pinned, created_at
    FROM discussion_post`;

/**
 * Postgres-backed discussion store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants.
 */
export function createPrismaStore(): DiscussionStore {
  return {
    async createForum(ctx, input: NewForumInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ForumRow[]>(
          `INSERT INTO discussion_forum (tenant_id, course_id, title, position)
           VALUES (
             $1::uuid, $2::uuid, $3,
             COALESCE($4, (SELECT COUNT(*)::int FROM discussion_forum
                            WHERE course_id = $2::uuid))
           )
           RETURNING id, tenant_id, course_id, title, position`,
          ctx.tenantId,
          input.courseId,
          input.title,
          input.position ?? null,
        );
        return toForum(rows[0]!);
      });
    },

    async listForums(ctx, courseId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ForumRow[]>(
          `SELECT id, tenant_id, course_id, title, position
             FROM discussion_forum WHERE course_id = $1::uuid ORDER BY position`,
          courseId,
        );
        return rows.map(toForum);
      });
    },

    async createTopic(ctx, forumId, input: NewTopicInput) {
      return withTenant(ctx, async (db) => {
        const forumRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM discussion_forum WHERE id = $1::uuid LIMIT 1`,
          forumId,
        );
        if (forumRows.length === 0) return null;
        const rows = await db.$queryRawUnsafe<TopicRow[]>(
          `INSERT INTO discussion_topic (tenant_id, forum_id, title, description)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           RETURNING id, tenant_id, forum_id, title, description`,
          ctx.tenantId,
          forumId,
          input.title,
          input.description ?? null,
        );
        return toTopic(rows[0]!);
      });
    },

    async listTopics(ctx, forumId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<TopicRow[]>(
          `SELECT id, tenant_id, forum_id, title, description
             FROM discussion_topic WHERE forum_id = $1::uuid ORDER BY title`,
          forumId,
        );
        return rows.map(toTopic);
      });
    },

    async createPost(ctx, topicId, input: NewPostInput) {
      return withTenant<CreatePostResult>(ctx, async (db) => {
        const topicRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM discussion_topic WHERE id = $1::uuid LIMIT 1`,
          topicId,
        );
        if (topicRows.length === 0) {
          return { ok: false, reason: "unknown_topic" };
        }
        if (input.parentId) {
          const parentRows = await db.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM discussion_post
              WHERE id = $1::uuid AND topic_id = $2::uuid LIMIT 1`,
            input.parentId,
            topicId,
          );
          if (parentRows.length === 0) {
            return { ok: false, reason: "unknown_parent" };
          }
        }
        const rows = await db.$queryRawUnsafe<PostRow[]>(
          `INSERT INTO discussion_post
             (tenant_id, topic_id, parent_id, author_id, body)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)
           RETURNING id, tenant_id, topic_id, parent_id, author_id, body,
                     is_pinned, created_at`,
          ctx.tenantId,
          topicId,
          input.parentId ?? null,
          input.authorId,
          input.body,
        );
        return { ok: true, post: toPost(rows[0]!) };
      });
    },

    async listPosts(ctx, topicId) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<PostRow[]>(
          `${SELECT_POST}
            WHERE topic_id = $1::uuid
            ORDER BY is_pinned DESC, created_at`,
          topicId,
        );
        return rows.map(toPost);
      });
    },

    async getThread(ctx, topicId): Promise<ThreadNode[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<PostRow[]>(
          `${SELECT_POST} WHERE topic_id = $1::uuid ORDER BY created_at`,
          topicId,
        );
        return buildThread(rows.map(toPost));
      });
    },

    async setPinned(ctx, postId, pinned) {
      return withTenant(ctx, async (db) => {
        const updated = await db.$executeRawUnsafe(
          `UPDATE discussion_post SET is_pinned = $2 WHERE id = $1::uuid`,
          postId,
          pinned,
        );
        if (updated === 0) return null;
        const rows = await db.$queryRawUnsafe<PostRow[]>(
          `${SELECT_POST} WHERE id = $1::uuid LIMIT 1`,
          postId,
        );
        return rows[0] ? toPost(rows[0]) : null;
      });
    },

    async updatePost(ctx, postId, body) {
      return withTenant(ctx, async (db) => {
        const updated = await db.$executeRawUnsafe(
          `UPDATE discussion_post SET body = $2 WHERE id = $1::uuid`,
          postId,
          body,
        );
        if (updated === 0) return null;
        const rows = await db.$queryRawUnsafe<PostRow[]>(
          `${SELECT_POST} WHERE id = $1::uuid LIMIT 1`,
          postId,
        );
        return rows[0] ? toPost(rows[0]) : null;
      });
    },

    async deletePost(ctx, postId) {
      return withTenant(ctx, async (db) => {
        const deleted = await db.$executeRawUnsafe(
          `DELETE FROM discussion_post WHERE id = $1::uuid`,
          postId,
        );
        return deleted > 0;
      });
    },

    async participation(ctx, forumId): Promise<ParticipationRow[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<
          { author_id: string; posts: number | string }[]
        >(
          `SELECT p.author_id, COUNT(*)::int AS posts
             FROM discussion_post p
             JOIN discussion_topic t ON t.id = p.topic_id
            WHERE t.forum_id = $1::uuid
            GROUP BY p.author_id
            ORDER BY posts DESC, p.author_id`,
          forumId,
        );
        return rows.map((r) => ({
          authorId: r.author_id,
          posts: Number(r.posts),
        }));
      });
    },
  };
}
