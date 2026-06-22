import type { TenantContext } from "@lms/types";

/** Dimension of every embedding vector (matches `ai_embedding.embedding vector(1024)`). */
export const EMBED_DIM = 1024;

/** A retrieved/citable chunk of course content with its cosine similarity score. */
export interface Citation {
  sourceType: string;
  sourceId: string;
  chunk: string;
  score: number;
}

/** Groundable content read from the content service's tables (read-only). */
export interface TopicContent {
  topicId: string;
  title: string;
  body: string;
}

/** A single embedding row to persist for a course. */
export interface EmbeddingInput {
  sourceType: string;
  sourceId: string;
  chunk: string;
  embedding: number[];
}

/** A persisted chat conversation owned by a user, scoped to a course. */
export interface ChatRecord {
  id: string;
  userId: string;
  courseId: string | null;
  feature: string;
  createdAt: string;
}

/** A persisted message within a chat. */
export interface MessageRecord {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  citations: Citation[];
  createdAt: string;
}

export interface NewChatInput {
  userId: string;
  courseId: string;
  feature: string;
}

export interface NewMessageInput {
  chatId: string;
  role: MessageRecord["role"];
  content: string;
  citations: Citation[];
}

/**
 * Persistence boundary for the ai service. Routes depend only on this interface,
 * so production uses an RLS-scoped Postgres implementation while tests inject an
 * in-memory one — mirroring the other domain services. Every method is
 * tenant-scoped (Postgres RLS in prod, an explicit tenant filter in memory).
 */
export interface AiStore {
  /** Read groundable topic content for a course (joins content_topic→content_module). */
  readCourseTopics(ctx: TenantContext, courseId: string): Promise<TopicContent[]>;

  /**
   * Replace all embeddings for `(courseId, sourceType)` with `rows`
   * (delete-then-insert). Returns the number of rows inserted.
   */
  replaceEmbeddings(
    ctx: TenantContext,
    courseId: string,
    sourceType: string,
    rows: EmbeddingInput[],
  ): Promise<number>;

  /** Top-k cosine retrieval over a course's embeddings (RLS supplies tenant). */
  retrieve(
    ctx: TenantContext,
    courseId: string,
    queryEmbedding: number[],
    k: number,
  ): Promise<Citation[]>;

  createChat(ctx: TenantContext, input: NewChatInput): Promise<ChatRecord>;

  getChat(ctx: TenantContext, chatId: string): Promise<ChatRecord | null>;

  addMessage(ctx: TenantContext, input: NewMessageInput): Promise<MessageRecord>;

  /** List a caller's chats for a course (newest first). */
  listChats(
    ctx: TenantContext,
    courseId: string,
    userId: string,
  ): Promise<ChatRecord[]>;

  /** List messages for a chat (oldest first). */
  listMessages(ctx: TenantContext, chatId: string): Promise<MessageRecord[]>;
}

/**
 * Split `text` into chunks of roughly `chunkSize` characters, breaking on
 * whitespace so words aren't split mid-token. Returns an empty array for blank
 * input. Pure and unit-testable without a store.
 */
export function chunkText(text: string, chunkSize = 1000): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  const words = normalized.split(" ");
  let current = "";
  for (const word of words) {
    if (current.length > 0 && current.length + 1 + word.length > chunkSize) {
      chunks.push(current);
      current = word;
    } else {
      current = current.length === 0 ? word : `${current} ${word}`;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Cosine similarity of two equal-length vectors (0 when either is a zero vector). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Format a numeric vector as a pgvector literal string: `[v0,v1,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
