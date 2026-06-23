/**
 * Transport-agnostic rate-limiting core.
 *
 * A {@link RateLimiter} counts hits against a key in a fixed time window and
 * reports whether the caller is within budget. The seam keeps the policy
 * transport-agnostic: production uses {@link UpstashRateLimiter} (shared across
 * service instances via Upstash Redis REST), while dev/test use
 * {@link MemoryRateLimiter}. Services layer their own (fastify-coupled) guards
 * on top of this primitive — the gateway's per-tenant guard and the ai service's
 * per-user/per-tenant chat limits both consume this same core.
 */
import type { AppConfig } from "@lms/config";

/** Fallbacks used when a (partial) config omits the rate-limit settings. */
export const DEFAULT_RATE_LIMIT_MAX = 600;
export const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number;
}

/** Counts a hit against `key` and reports whether it is within `limit`. */
export interface RateLimiter {
  check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult>;
}

interface Bucket {
  count: number;
  /** Epoch ms when this window resets. */
  resetAt: number;
}

/**
 * In-process fixed-window limiter. Per-instance only (not shared across service
 * replicas) — fine for local dev and tests; use {@link UpstashRateLimiter} in
 * production. Expired buckets are evicted lazily on access.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs) {
      bucket = { count: 0, resetAt: nowMs + windowSeconds * 1000 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const allowed = bucket.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000)),
    };
  }
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ json(): Promise<unknown> }>;

/**
 * Upstash Redis REST limiter — shared across service instances. Uses a single
 * pipeline of INCR + EXPIRE(NX) + PTTL on a per-key counter: the first hit in a
 * window creates the counter and sets its TTL; the TTL drives Retry-After.
 * `fetchImpl` is injectable so the adapter is unit-testable without a network.
 */
export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const res = await this.fetchImpl(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(windowSeconds), "NX"],
        ["PTTL", key],
      ]),
    });
    const data = (await res.json()) as { result?: unknown }[];
    const count = Number(data?.[0]?.result ?? 0);
    const pttlMs = Number(data?.[2]?.result ?? windowSeconds * 1000);
    const allowed = count <= limit;
    const retryAfterSeconds =
      pttlMs > 0 ? Math.ceil(pttlMs / 1000) : windowSeconds;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, retryAfterSeconds),
    };
  }
}

/** Pick the limiter implementation from config (Upstash when configured). */
export function createRateLimiter(config: AppConfig): RateLimiter {
  if (config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashRateLimiter(
      config.UPSTASH_REDIS_REST_URL,
      config.UPSTASH_REDIS_REST_TOKEN,
    );
  }
  return new MemoryRateLimiter();
}
