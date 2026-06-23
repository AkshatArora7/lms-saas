import type { AppConfig } from "@lms/config";
import type { RateLimiter, RateLimitResult } from "@lms/ratelimit";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  buildGroundedMessages,
  buildQuestionGenMessages,
  parseQuestionDrafts,
  QUESTION_DIFFICULTIES,
  QUESTION_DRAFT_KINDS,
  type ChatModel,
  type QuestionGenParams,
} from "./chat.js";
import type { Embedder } from "./embedder.js";
import { chunkText, type AiStore, type Citation } from "./store.js";

const CONTENT_SOURCE_TYPE = "content_topic";
const RETRIEVAL_K = 5;
const CHAT_FEATURE = "tutor";
/** Reject student messages longer than this before any embed/retrieve/model call. */
const MAX_MESSAGE_CHARS = 4000;

export interface AiRouteDeps {
  config: AppConfig;
  store: AiStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
  embedder: Embedder;
  chat: ChatModel;
  /** Fixed-window limiter for the per-user/per-tenant chat rate limits (#309). */
  limiter: RateLimiter;
}

function resolveTenantOr400(
  deps: AiRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): TenantContext | null {
  try {
    return deps.resolveTenant(req);
  } catch {
    void reply
      .code(400)
      .send({ error: "tenant_required", message: "Missing tenant context." });
    return null;
  }
}

/** Trusted caller identity, stamped by the gateway as `x-user-id` (ADR-0027). */
function resolveUserId(req: FastifyRequest): string | null {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: "not_found", message });
}

/**
 * Send a 429 `rate_limited` response, mirroring the gateway's header style
 * (`RateLimit-Limit`/`RateLimit-Remaining`/`Retry-After`). `result` is the
 * breached limiter outcome; `scope` distinguishes per-user vs per-tenant in the
 * human-readable message while keeping `error: "rate_limited"` stable.
 */
function rateLimited(
  reply: FastifyReply,
  result: RateLimitResult,
  scope: string,
): FastifyReply {
  void reply.header("RateLimit-Limit", String(result.limit));
  void reply.header("RateLimit-Remaining", String(result.remaining));
  return reply
    .header("Retry-After", String(result.retryAfterSeconds))
    .code(429)
    .send({
      error: "rate_limited",
      message: `AI chat rate limit exceeded (${scope}). Retry after the window resets.`,
    });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Body schema for question-draft generation (zod, per architect §4 Decision 4). */
const questionGenBodySchema = z
  .object({
    count: z.number().int().min(1).max(20).optional(),
    kinds: z.array(z.enum(QUESTION_DRAFT_KINDS)).min(1).optional(),
    difficulty: z.enum(QUESTION_DIFFICULTIES).optional(),
    topic: z.string().optional(),
    sourceText: z.string().optional(),
  })
  .refine((b) => isNonEmptyString(b.topic) || isNonEmptyString(b.sourceText), {
    message: "At least one of topic or sourceText is required.",
  });

/** Register the ai surface: reindex, RAG chat, and chat/message history reads. */
export function registerAiRoutes(app: FastifyInstance, deps: AiRouteDeps): void {
  // (Re)build the embedding index for a course (idempotent delete-then-insert).
  app.post<{ Params: { courseId: string }; Body: { chunkSize?: number } }>(
    "/courses/:courseId/reindex",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const { courseId } = req.params;
      const body = (req.body ?? {}) as { chunkSize?: number };
      const chunkSize =
        typeof body.chunkSize === "number" && body.chunkSize > 0
          ? body.chunkSize
          : 1000;

      const topics = await deps.store.readCourseTopics(ctx, courseId);
      const rows: { sourceId: string; chunk: string }[] = [];
      for (const topic of topics) {
        for (const chunk of chunkText(topic.body, chunkSize)) {
          rows.push({ sourceId: topic.topicId, chunk });
        }
      }

      let embedded = 0;
      if (rows.length > 0) {
        const vectors = await deps.embedder.embed(rows.map((r) => r.chunk));
        embedded = await deps.store.replaceEmbeddings(
          ctx,
          courseId,
          CONTENT_SOURCE_TYPE,
          rows.map((r, i) => ({
            sourceType: CONTENT_SOURCE_TYPE,
            sourceId: r.sourceId,
            chunk: r.chunk,
            embedding: vectors[i]!,
          })),
        );
      } else {
        // No groundable content: clear any stale embeddings for the course.
        await deps.store.replaceEmbeddings(ctx, courseId, CONTENT_SOURCE_TYPE, []);
      }

      return reply.code(200).send({
        courseId,
        topics: topics.length,
        chunks: rows.length,
        embedded,
      });
    },
  );

  // RAG answer grounded in the course's content, persisted to a chat.
  app.post<{
    Params: { courseId: string };
    Body: { message?: unknown; chatId?: unknown };
  }>("/courses/:courseId/chat", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const userId = resolveUserId(req);
    if (!userId) {
      return reply
        .code(400)
        .send({ error: "user_required", message: "Missing x-user-id." });
    }
    const { courseId } = req.params;
    const body = (req.body ?? {}) as { message?: unknown; chatId?: unknown };
    if (!isNonEmptyString(body.message)) {
      return badRequest(reply, "message is required.");
    }
    const message = body.message.trim();
    if (message.length > MAX_MESSAGE_CHARS) {
      return badRequest(reply, "message is too long.");
    }

    // Rate limits + cost ceiling (#309). Enforced AFTER cheap validation but
    // BEFORE any embed/retrieve/Groq work (those cost money + latency). Per-user
    // first so one user can't drain the whole tenant budget, then per-tenant,
    // then the durable per-UTC-day spend ceiling.
    const windowSeconds = deps.config.AI_CHAT_RATE_LIMIT_WINDOW_SECONDS;
    const userResult = await deps.limiter.check(
      `ai:chat:user:${ctx.tenantId}:${userId}`,
      deps.config.AI_CHAT_USER_RATE_LIMIT_MAX,
      windowSeconds,
    );
    if (!userResult.allowed) {
      return rateLimited(reply, userResult, "per-user");
    }
    const tenantResult = await deps.limiter.check(
      `ai:chat:tenant:${ctx.tenantId}`,
      deps.config.AI_CHAT_RATE_LIMIT_MAX,
      windowSeconds,
    );
    if (!tenantResult.allowed) {
      return rateLimited(reply, tenantResult, "per-tenant");
    }

    const windowDate = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const usage = await deps.store.getTenantDailyUsage(ctx, windowDate);
    const requestCeiling = deps.config.AI_CHAT_DAILY_TENANT_REQUEST_CEILING;
    const tokenCeiling = deps.config.AI_CHAT_DAILY_TENANT_TOKEN_CEILING;
    if (
      (requestCeiling > 0 && usage.requestCount >= requestCeiling) ||
      (tokenCeiling > 0 && usage.tokenEstimate >= tokenCeiling)
    ) {
      return reply.code(429).send({
        error: "cost_exceeded",
        message: "Daily AI usage ceiling reached for this tenant.",
      });
    }

    // Resolve (and authorize) the chat, or create a new one for this caller.
    let chatId: string;
    if (isNonEmptyString(body.chatId)) {
      const existing = await deps.store.getChat(ctx, body.chatId.trim());
      if (!existing || existing.userId !== userId) {
        return notFound(reply, "Chat not found.");
      }
      chatId = existing.id;
    } else {
      const chat = await deps.store.createChat(ctx, {
        userId,
        courseId,
        feature: CHAT_FEATURE,
      });
      chatId = chat.id;
    }

    const [queryVector] = await deps.embedder.embed([message]);
    const citations: Citation[] = await deps.store.retrieve(
      ctx,
      courseId,
      queryVector!,
      RETRIEVAL_K,
    );
    const answer = await deps.chat.complete(
      buildGroundedMessages(message, citations),
      { maxTokens: deps.config.GROQ_MAX_TOKENS },
    );

    await deps.store.addMessage(ctx, {
      chatId,
      role: "user",
      content: message,
      citations: [],
    });
    await deps.store.addMessage(ctx, {
      chatId,
      role: "assistant",
      content: answer,
      citations,
    });

    // Record worst-case token spend for the tenant's daily ceiling — only after
    // a successful completion (we never charge a tenant for a failed request).
    await deps.store.incrementTenantDailyUsage(
      ctx,
      windowDate,
      deps.config.GROQ_MAX_TOKENS,
    );

    return reply.code(200).send({ chatId, answer, citations });
  });

  // List the caller's chats for a course.
  app.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/chats",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const userId = resolveUserId(req);
      if (!userId) {
        return reply
          .code(400)
          .send({ error: "user_required", message: "Missing x-user-id." });
      }
      const chats = await deps.store.listChats(ctx, req.params.courseId, userId);
      return reply.code(200).send({
        chats: chats.map((c) => ({
          id: c.id,
          feature: c.feature,
          createdAt: c.createdAt,
        })),
      });
    },
  );

  // List messages for one of the caller's chats.
  app.get<{ Params: { chatId: string } }>(
    "/chats/:chatId/messages",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const userId = resolveUserId(req);
      if (!userId) {
        return reply
          .code(400)
          .send({ error: "user_required", message: "Missing x-user-id." });
      }
      const chat = await deps.store.getChat(ctx, req.params.chatId);
      if (!chat || chat.userId !== userId) {
        return notFound(reply, "Chat not found.");
      }
      const messages = await deps.store.listMessages(ctx, req.params.chatId);
      return reply.code(200).send({ messages });
    },
  );

  // Generate transient draft quiz questions from a topic/reading (issue #65).
  // Stateless: no tenant DB read, nothing persisted — drafts are returned for
  // human review/edit and the client maps approved drafts to the question bank.
  app.post<{ Params: { courseId: string }; Body: unknown }>(
    "/courses/:courseId/question-drafts",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const userId = resolveUserId(req);
      if (!userId) {
        return reply
          .code(400)
          .send({ error: "user_required", message: "Missing x-user-id." });
      }

      const parsed = questionGenBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return badRequest(
          reply,
          parsed.error.issues[0]?.message ?? "Invalid request body.",
        );
      }

      const params: QuestionGenParams = {
        count: parsed.data.count ?? 5,
        kinds: parsed.data.kinds ?? [...QUESTION_DRAFT_KINDS],
        difficulty: parsed.data.difficulty ?? "medium",
        topic: parsed.data.topic,
        sourceText: parsed.data.sourceText,
      };

      const raw = await deps.chat.complete(buildQuestionGenMessages(params));
      const drafts = parseQuestionDrafts(raw, params);
      if (drafts.length === 0) {
        return reply.code(502).send({
          error: "generation_failed",
          message: "The model did not return any usable questions.",
        });
      }

      return reply.code(200).send({ drafts });
    },
  );
}
