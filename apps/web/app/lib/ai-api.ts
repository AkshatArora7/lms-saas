import { TENANT_ID } from "./auth";
import { listModules, listTopics } from "./content-api";
import {
  type AiErrorCode,
  type ChatMessage,
  type ChatRole,
  type EnrichedCitation,
  type RawCitation,
} from "./ai-types";

export {
  MAX_MESSAGE_CHARS,
  type AiErrorCode,
  type ChatMessage,
  type ChatRole,
  type EnrichedCitation,
  type RawCitation,
} from "./ai-types";

/**
 * Server-only client for the AI microservice (#313), for the learner web app.
 *
 * The course tutor is a course-scoped RAG chat. Every call forwards the
 * authenticated tenant as the trusted `x-tenant-id` header AND the
 * server-resolved learner as `x-user-id` — the callers (the BFF route handlers
 * under app/api/ai/*) ALWAYS pass `session.tenantId`/`session.userId`, never a
 * client-supplied value, so a learner can't chat or read history as someone
 * else. The ai service rejects a missing identity with `400 user_required`.
 *
 * The chat response carries citations as `{ sourceType, sourceId, chunk,
 * score }` with NO title and NO href (services/ai/src/store.ts). We enrich each
 * distinct `sourceId` (a content_topic id) with a human title best-effort via
 * the content service, falling back to a generic label. Enrichment never blocks
 * or fails the answer: an unresolved title just keeps `title: null`.
 *
 * Mutations return discriminated-union results so the BFF route handlers can map
 * the ai service's 4xx/429 codes (incl. rate-limit / cost-ceiling, Retry-After
 * aware) into the right UI state.
 */

export const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL ?? "http://localhost:4017";

export interface SendChatInput {
  message: string;
  chatId?: string;
}

export interface SendChatPayload {
  chatId: string;
  answer: string;
  citations: EnrichedCitation[];
}

export type SendChatResult =
  | { ok: true; data: SendChatPayload }
  | { ok: false; status: number; code: AiErrorCode; retryAfter?: number };

export type LoadHistoryResult =
  | { ok: true; chatId: string | null; messages: ChatMessage[] }
  | { ok: false; status: number; code: AiErrorCode };

function jsonHeaders(tenantId: string, userId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
    "x-user-id": userId,
  };
}

function identityHeaders(tenantId: string, userId: string): HeadersInit {
  return { "x-tenant-id": tenantId, "x-user-id": userId };
}

/** Map an ai-service error `error` field + status to a stable client code. */
function mapErrorCode(status: number, body: { error?: string }): AiErrorCode {
  const error = body.error;
  if (
    error === "invalid_request" ||
    error === "user_required" ||
    error === "tenant_required" ||
    error === "not_found" ||
    error === "rate_limited" ||
    error === "cost_exceeded"
  ) {
    return error;
  }
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_request";
  return "error";
}

/** Parse a Retry-After (seconds) or RateLimit-Reset header, if present. */
function parseRetryAfter(res: Response): number | undefined {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  const reset = res.headers.get("ratelimit-reset");
  if (reset) {
    const seconds = Number(reset);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  return undefined;
}

/**
 * Build a `{ topicId: title }` map for a course by walking modules + their
 * topics once. Used to enrich citation chips with a readable title. Best-effort:
 * any failure yields an empty map and chips fall back to a generic label.
 */
async function buildTopicTitleMap(
  courseId: string,
  tenantId: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    const modules = await listModules(courseId, tenantId);
    const topicLists = await Promise.all(
      modules.map((module) => listTopics(module.id, tenantId)),
    );
    for (const topics of topicLists) {
      for (const topic of topics) {
        titles.set(topic.id, topic.title);
      }
    }
  } catch {
    // Enrichment is non-blocking; return whatever we have.
  }
  return titles;
}

/**
 * Enrich raw citations with a resolved title (best-effort) and a learner item
 * href. Distinct sourceIds drive a single title-map walk per call. Citations
 * with no matching topic keep `title: null` so the client can render a fallback.
 */
export async function enrichCitations(
  courseId: string,
  raw: RawCitation[],
  tenantId: string = TENANT_ID,
): Promise<EnrichedCitation[]> {
  if (raw.length === 0) return [];
  const titles = await buildTopicTitleMap(courseId, tenantId);
  return raw.map((citation) => ({
    sourceType: citation.sourceType,
    sourceId: citation.sourceId,
    chunk: citation.chunk,
    score: citation.score,
    title: titles.get(citation.sourceId) ?? null,
    href: `/courses/${encodeURIComponent(courseId)}/items/${encodeURIComponent(
      citation.sourceId,
    )}`,
  }));
}

/**
 * Send a question to the course tutor. Enriches the returned citations with
 * topic titles before resolving. Identity is injected by the caller (the BFF),
 * never the client.
 */
export async function sendTutorChat(
  courseId: string,
  userId: string,
  input: SendChatInput,
  tenantId: string = TENANT_ID,
): Promise<SendChatResult> {
  const requestBody: SendChatInput = { message: input.message };
  if (input.chatId) requestBody.chatId = input.chatId;

  let res: Response;
  try {
    res = await fetch(
      `${AI_SERVICE_URL}/courses/${encodeURIComponent(courseId)}/chat`,
      {
        method: "POST",
        headers: jsonHeaders(tenantId, userId),
        body: JSON.stringify(requestBody),
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, status: 503, code: "unavailable" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const code = mapErrorCode(res.status, body);
    const result: SendChatResult = { ok: false, status: res.status, code };
    if (code === "rate_limited") {
      const retryAfter = parseRetryAfter(res);
      if (retryAfter !== undefined) result.retryAfter = retryAfter;
    }
    return result;
  }

  const data = (await res.json()) as {
    chatId: string;
    answer: string;
    citations: RawCitation[];
  };
  const citations = await enrichCitations(
    courseId,
    data.citations ?? [],
    tenantId,
  );
  return {
    ok: true,
    data: { chatId: data.chatId, answer: data.answer, citations },
  };
}

interface ChatSummary {
  id: string;
  feature: string;
  createdAt: string;
}

interface RawMessage {
  role: ChatRole;
  content: string;
  citations: RawCitation[];
  createdAt: string;
}

/** List the caller's chats for a course (newest first). */
async function listChats(
  courseId: string,
  userId: string,
  tenantId: string,
): Promise<ChatSummary[]> {
  const res = await fetch(
    `${AI_SERVICE_URL}/courses/${encodeURIComponent(courseId)}/chats`,
    { headers: identityHeaders(tenantId, userId), cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { chats: ChatSummary[] };
  return data.chats ?? [];
}

/** List messages for one of the caller's chats (oldest first). */
async function listMessages(
  chatId: string,
  userId: string,
  tenantId: string,
): Promise<RawMessage[]> {
  const res = await fetch(
    `${AI_SERVICE_URL}/chats/${encodeURIComponent(chatId)}/messages`,
    { headers: identityHeaders(tenantId, userId), cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { messages: RawMessage[] };
  return data.messages ?? [];
}

/**
 * Load the learner's most recent tutor conversation for a course, server-side,
 * to seed the chat panel. Returns the threadable chatId + enriched messages, or
 * an empty conversation when there is no prior chat. Filters out non-displayable
 * roles (system/tool) so the UI shows only user/assistant turns.
 *
 * Degrades to an empty conversation on any read failure so the page can still
 * render the composer + empty state rather than erroring.
 */
export async function loadTutorHistory(
  courseId: string,
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<LoadHistoryResult> {
  try {
    const chats = await listChats(courseId, userId, tenantId);
    const tutorChat = chats.find((chat) => chat.feature === "tutor") ?? null;
    if (!tutorChat) {
      return { ok: true, chatId: null, messages: [] };
    }
    const rawMessages = await listMessages(tutorChat.id, userId, tenantId);
    const titles = await buildTopicTitleMap(courseId, tenantId);
    const messages: ChatMessage[] = rawMessages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        citations: (message.citations ?? []).map((citation) => ({
          sourceType: citation.sourceType,
          sourceId: citation.sourceId,
          chunk: citation.chunk,
          score: citation.score,
          title: titles.get(citation.sourceId) ?? null,
          href: `/courses/${encodeURIComponent(courseId)}/items/${encodeURIComponent(
            citation.sourceId,
          )}`,
        })),
      }));
    return { ok: true, chatId: tutorChat.id, messages };
  } catch {
    return { ok: true, chatId: null, messages: [] };
  }
}
