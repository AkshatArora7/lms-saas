import { withTenant } from "@lms/db";

import {
  toVectorLiteral,
  type AiStore,
  type Citation,
  type ChatRecord,
  type EmbeddingInput,
  type MessageRecord,
  type NewChatInput,
  type NewMessageInput,
  type TenantDailyUsage,
  type TopicContent,
} from "./store.js";

interface TopicRow {
  source_id: string;
  title: string;
  body: string;
}

interface RetrievalRow {
  source_type: string;
  source_id: string;
  chunk: string;
  score: number | string;
}

interface ChatRow {
  id: string;
  user_id: string;
  course_id: string | null;
  feature: string;
  created_at: Date | string;
}

interface MessageRow {
  role: MessageRecord["role"];
  content: string;
  citations: unknown;
  created_at: Date | string;
}

interface UsageRow {
  request_count: number | string;
  token_estimate: number | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseCitations(value: unknown): Citation[] {
  if (Array.isArray(value)) return value as Citation[];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Citation[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toChatRecord(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    feature: row.feature,
    createdAt: iso(row.created_at),
  };
}

function toMessageRecord(row: MessageRow): MessageRecord {
  return {
    role: row.role,
    content: row.content,
    citations: parseCitations(row.citations),
    createdAt: iso(row.created_at),
  };
}

/**
 * Postgres-backed ai store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — embeddings, chats and messages can never leak across
 * tenants, and reindex reads content_topic under the same tenant scope.
 */
export function createPrismaStore(): AiStore {
  return {
    async readCourseTopics(ctx, courseId): Promise<TopicContent[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<TopicRow[]>(
          `SELECT t.id AS source_id, t.title, t.body
             FROM content_topic t
             JOIN content_module m ON t.module_id = m.id
            WHERE m.course_id = $1::uuid
              AND t.body IS NOT NULL
              AND length(btrim(t.body)) > 0
            ORDER BY m.position, t.position`,
          courseId,
        );
        return rows.map((r) => ({
          topicId: r.source_id,
          title: r.title,
          body: r.body,
        }));
      });
    },

    async replaceEmbeddings(
      ctx,
      courseId,
      sourceType,
      rows: EmbeddingInput[],
    ): Promise<number> {
      return withTenant(ctx, async (db) => {
        await db.$executeRawUnsafe(
          `DELETE FROM ai_embedding
            WHERE course_id = $1::uuid AND source_type = $2`,
          courseId,
          sourceType,
        );
        for (const row of rows) {
          await db.$executeRawUnsafe(
            `INSERT INTO ai_embedding
               (tenant_id, course_id, source_type, source_id, chunk, embedding)
             VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::vector)`,
            ctx.tenantId,
            courseId,
            sourceType,
            row.sourceId,
            row.chunk,
            toVectorLiteral(row.embedding),
          );
        }
        return rows.length;
      });
    },

    async retrieve(ctx, courseId, queryEmbedding, k): Promise<Citation[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<RetrievalRow[]>(
          `SELECT source_type, source_id, chunk,
                  1 - (embedding <=> $2::vector) AS score
             FROM ai_embedding
            WHERE course_id = $1::uuid
              AND embedding IS NOT NULL
            ORDER BY embedding <=> $2::vector
            LIMIT $3`,
          courseId,
          toVectorLiteral(queryEmbedding),
          k,
        );
        return rows.map((r) => ({
          sourceType: r.source_type,
          sourceId: r.source_id,
          chunk: r.chunk,
          score: Number(r.score),
        }));
      });
    },

    async createChat(ctx, input: NewChatInput): Promise<ChatRecord> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ChatRow[]>(
          `INSERT INTO ai_chat (tenant_id, user_id, course_id, feature)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
           RETURNING id, user_id, course_id, feature, created_at`,
          ctx.tenantId,
          input.userId,
          input.courseId,
          input.feature,
        );
        return toChatRecord(rows[0]!);
      });
    },

    async getChat(ctx, chatId): Promise<ChatRecord | null> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ChatRow[]>(
          `SELECT id, user_id, course_id, feature, created_at
             FROM ai_chat WHERE id = $1::uuid LIMIT 1`,
          chatId,
        );
        return rows[0] ? toChatRecord(rows[0]) : null;
      });
    },

    async addMessage(ctx, input: NewMessageInput): Promise<MessageRecord> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<MessageRow[]>(
          `INSERT INTO ai_message (tenant_id, chat_id, role, content, citations)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
           RETURNING role, content, citations, created_at`,
          ctx.tenantId,
          input.chatId,
          input.role,
          input.content,
          JSON.stringify(input.citations),
        );
        return toMessageRecord(rows[0]!);
      });
    },

    async listChats(ctx, courseId, userId): Promise<ChatRecord[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ChatRow[]>(
          `SELECT id, user_id, course_id, feature, created_at
             FROM ai_chat
            WHERE course_id = $1::uuid AND user_id = $2::uuid
            ORDER BY created_at DESC`,
          courseId,
          userId,
        );
        return rows.map(toChatRecord);
      });
    },

    async listMessages(ctx, chatId): Promise<MessageRecord[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<MessageRow[]>(
          `SELECT role, content, citations, created_at
             FROM ai_message
            WHERE chat_id = $1::uuid
            ORDER BY created_at`,
          chatId,
        );
        return rows.map(toMessageRecord);
      });
    },

    async getTenantDailyUsage(ctx, windowDate): Promise<TenantDailyUsage> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<UsageRow[]>(
          `SELECT request_count, token_estimate
             FROM ai_usage
            WHERE tenant_id = $1::uuid AND window_date = $2::date
            LIMIT 1`,
          ctx.tenantId,
          windowDate,
        );
        const row = rows[0];
        if (!row) return { requestCount: 0, tokenEstimate: 0 };
        return {
          requestCount: Number(row.request_count),
          tokenEstimate: Number(row.token_estimate),
        };
      });
    },

    async incrementTenantDailyUsage(ctx, windowDate, tokens): Promise<void> {
      await withTenant(ctx, async (db) => {
        await db.$executeRawUnsafe(
          `INSERT INTO ai_usage (tenant_id, window_date, request_count, token_estimate)
           VALUES ($1::uuid, $2::date, 1, $3::bigint)
           ON CONFLICT (tenant_id, window_date)
           DO UPDATE SET request_count = ai_usage.request_count + 1,
                         token_estimate = ai_usage.token_estimate + EXCLUDED.token_estimate,
                         updated_at = now()`,
          ctx.tenantId,
          windowDate,
          tokens,
        );
      });
    },
  };
}
