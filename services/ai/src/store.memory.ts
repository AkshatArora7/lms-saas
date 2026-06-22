import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  cosineSimilarity,
  type AiStore,
  type Citation,
  type ChatRecord,
  type EmbeddingInput,
  type MessageRecord,
  type NewChatInput,
  type NewMessageInput,
  type TopicContent,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface TopicRow extends TopicContent {
  tenantId: string;
  courseId: string;
}

interface EmbeddingRow {
  tenantId: string;
  courseId: string;
  sourceType: string;
  sourceId: string;
  chunk: string;
  embedding: number[];
}

interface ChatRow extends ChatRecord {
  tenantId: string;
}

interface MessageRow extends MessageRecord {
  tenantId: string;
  chatId: string;
}

/**
 * In-memory AiStore. Rows are filtered by tenant id to emulate the row-level
 * isolation Postgres RLS enforces in production. Used by the test suite and
 * `AI_STORE=memory`. Cosine retrieval is computed in JS.
 */
export class MemoryAiStore implements AiStore {
  private topics: TopicRow[] = [];
  private embeddings: EmbeddingRow[] = [];
  private chats: ChatRow[] = [];
  private messages: MessageRow[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Seed groundable course content (the content service owns this in prod). */
  seedTopic(tenantId: string, courseId: string, topic: TopicContent): void {
    this.topics.push({ tenantId, courseId, ...topic });
  }

  async readCourseTopics(
    ctx: TenantContext,
    courseId: string,
  ): Promise<TopicContent[]> {
    return this.topics
      .filter(
        (t) =>
          t.tenantId === ctx.tenantId &&
          t.courseId === courseId &&
          t.body.trim().length > 0,
      )
      .map((t) => ({ topicId: t.topicId, title: t.title, body: t.body }));
  }

  async replaceEmbeddings(
    ctx: TenantContext,
    courseId: string,
    sourceType: string,
    rows: EmbeddingInput[],
  ): Promise<number> {
    this.embeddings = this.embeddings.filter(
      (e) =>
        !(
          e.tenantId === ctx.tenantId &&
          e.courseId === courseId &&
          e.sourceType === sourceType
        ),
    );
    for (const row of rows) {
      this.embeddings.push({
        tenantId: ctx.tenantId,
        courseId,
        sourceType,
        sourceId: row.sourceId,
        chunk: row.chunk,
        embedding: row.embedding,
      });
    }
    return rows.length;
  }

  async retrieve(
    ctx: TenantContext,
    courseId: string,
    queryEmbedding: number[],
    k: number,
  ): Promise<Citation[]> {
    return this.embeddings
      .filter((e) => e.tenantId === ctx.tenantId && e.courseId === courseId)
      .map((e) => ({
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        chunk: e.chunk,
        score: cosineSimilarity(queryEmbedding, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async createChat(
    ctx: TenantContext,
    input: NewChatInput,
  ): Promise<ChatRecord> {
    const record: ChatRow = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      userId: input.userId,
      courseId: input.courseId,
      feature: input.feature,
      createdAt: this.now().toISOString(),
    };
    this.chats.push(record);
    return this.toChatRecord(record);
  }

  async getChat(
    ctx: TenantContext,
    chatId: string,
  ): Promise<ChatRecord | null> {
    const row = this.chats.find(
      (c) => c.id === chatId && c.tenantId === ctx.tenantId,
    );
    return row ? this.toChatRecord(row) : null;
  }

  async addMessage(
    ctx: TenantContext,
    input: NewMessageInput,
  ): Promise<MessageRecord> {
    const record: MessageRow = {
      tenantId: ctx.tenantId,
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      citations: input.citations,
      createdAt: this.now().toISOString(),
    };
    this.messages.push(record);
    return this.toMessageRecord(record);
  }

  async listChats(
    ctx: TenantContext,
    courseId: string,
    userId: string,
  ): Promise<ChatRecord[]> {
    return this.chats
      .filter(
        (c) =>
          c.tenantId === ctx.tenantId &&
          c.courseId === courseId &&
          c.userId === userId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => this.toChatRecord(c));
  }

  async listMessages(
    ctx: TenantContext,
    chatId: string,
  ): Promise<MessageRecord[]> {
    return this.messages
      .filter((m) => m.tenantId === ctx.tenantId && m.chatId === chatId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m) => this.toMessageRecord(m));
  }

  private toChatRecord(row: ChatRow): ChatRecord {
    return {
      id: row.id,
      userId: row.userId,
      courseId: row.courseId,
      feature: row.feature,
      createdAt: row.createdAt,
    };
  }

  private toMessageRecord(row: MessageRow): MessageRecord {
    return {
      role: row.role,
      content: row.content,
      citations: row.citations,
      createdAt: row.createdAt,
    };
  }
}

/** Build a MemoryAiStore pre-seeded with a demo course's groundable content. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryAiStore {
  const store = new MemoryAiStore(generateId, now);
  store.seedTopic(DEMO_TENANT_ID, "demo-course", {
    topicId: "00000000-0000-0000-0000-0000000000a1",
    title: "Photosynthesis basics",
    body: "Photosynthesis is the process by which green plants convert sunlight, water, and carbon dioxide into glucose and oxygen. It occurs in the chloroplasts of plant cells.",
  });
  store.seedTopic(DEMO_TENANT_ID, "demo-course", {
    topicId: "00000000-0000-0000-0000-0000000000a2",
    title: "The water cycle",
    body: "The water cycle describes how water evaporates from the surface, condenses into clouds, and falls back to earth as precipitation such as rain and snow.",
  });
  return store;
}
