/**
 * Shared AI tutor types + constants for the learner web app (#313).
 *
 * Lives apart from `ai-api.ts` (the server-only client) because the client chat
 * island needs these types and the `MAX_MESSAGE_CHARS` constant. `ai-api.ts`
 * imports `auth.ts`, which pulls in `next/headers` and is therefore server-only;
 * a client component importing from it would break the build. This module has NO
 * server-only imports, so it is safe to import from a `"use client"` component.
 */

/** Max question length — mirrors the ai service's MAX_MESSAGE_CHARS guard. */
export const MAX_MESSAGE_CHARS = 4000;

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Raw citation from the ai service (no title / href). */
export interface RawCitation {
  sourceType: string;
  sourceId: string;
  chunk: string;
  score: number;
}

/**
 * Citation enriched for the UI: `title` is the resolved content-topic title (or
 * null when it couldn't be resolved → the client renders a fallback label) and
 * `href` is the learner item route for the cited topic.
 */
export interface EnrichedCitation {
  sourceType: string;
  sourceId: string;
  chunk: string;
  score: number;
  title: string | null;
  href: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  citations: EnrichedCitation[];
  createdAt: string;
}

/**
 * Discriminated error codes surfaced to the client so it can render the right
 * ErrorNotice. `rate_limited` may carry a `retryAfter` (seconds) when the ai
 * service sends a Retry-After / RateLimit-Reset header.
 */
export type AiErrorCode =
  | "invalid_request"
  | "user_required"
  | "tenant_required"
  | "not_found"
  | "rate_limited"
  | "cost_exceeded"
  | "unavailable"
  | "error";
