/**
 * Per-tenant rate limiting for the gateway.
 *
 * One tenant must not be able to degrade others, so every authenticated request
 * is counted against a per-tenant (and per-route) budget in a fixed time window.
 * The {@link RateLimiter} seam keeps the policy transport-agnostic: production
 * uses {@link UpstashRateLimiter} (shared across gateway instances via Upstash
 * Redis REST), while dev/test use {@link MemoryRateLimiter}. When the budget is
 * exceeded the gateway responds 429 with a `Retry-After` header.
 */
import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

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
 * In-process fixed-window limiter. Per-instance only (not shared across gateway
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
 * Upstash Redis REST limiter — shared across gateway instances. Uses a single
 * pipeline of INCR + EXPIRE(NX) + PTTL on a per-tenant/route key: the first hit
 * in a window creates the counter and sets its TTL; the TTL drives Retry-After.
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

/**
 * Resolve the per-window request budget for a tenant. Extensible by plan/tier;
 * for now every tenant gets the configured maximum. (Plan-specific budgets land
 * when the plan is carried in the access token / resolved from billing.)
 */
export type LimitResolver = (tenant: TenantContext, config: AppConfig) => number;

const defaultLimitResolver: LimitResolver = (_tenant, config) =>
  config.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX;

export interface RateLimitGuardOptions {
  limiter: RateLimiter;
  config: AppConfig;
  /** Override the per-tenant budget (e.g. by plan). */
  limitFor?: LimitResolver;
}

/** A short, stable route label for the rate-limit key (method + route path). */
function routeLabel(req: FastifyRequest): string {
  const url = (req as { routeOptions?: { url?: string } }).routeOptions?.url;
  return `${req.method}:${url ?? req.url.split("?")[0]}`;
}

/**
 * Pre-handler that enforces the per-tenant budget. Must run AFTER the auth guard
 * (it reads `req.tenant`). On breach it responds 429 with `Retry-After` and
 * `RateLimit-*` headers; otherwise it annotates the remaining budget.
 */
export function rateLimitGuard(
  options: RateLimitGuardOptions,
): preHandlerHookHandler {
  const windowSeconds =
    options.config.RATE_LIMIT_WINDOW_SECONDS ??
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS;
  const limitFor = options.limitFor ?? defaultLimitResolver;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const tenant = req.tenant;
    if (!tenant) return; // unauthenticated routes never reach here

    const limit = limitFor(tenant, options.config);
    const key = `ratelimit:${tenant.tenantId}:${routeLabel(req)}`;
    const result = await options.limiter.check(key, limit, windowSeconds);

    void reply.header("RateLimit-Limit", String(result.limit));
    void reply.header("RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      return reply
        .header("Retry-After", String(result.retryAfterSeconds))
        .code(429)
        .send({
          error: "rate_limited",
          message:
            "Rate limit exceeded for this tenant. Retry after the window resets.",
        });
    }
  };
}
