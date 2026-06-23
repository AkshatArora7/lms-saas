/**
 * Per-tenant rate limiting for the gateway.
 *
 * One tenant must not be able to degrade others, so every authenticated request
 * is counted against a per-tenant (and per-route) budget in a fixed time window.
 * The transport-agnostic limiter core (`RateLimiter`, `MemoryRateLimiter`,
 * `UpstashRateLimiter`, `createRateLimiter`) lives in `@lms/ratelimit` and is
 * shared across services. This module layers the gateway's fastify-coupled
 * policy on top: the per-tenant/per-route key + the `rateLimitGuard` pre-handler.
 * Production uses {@link UpstashRateLimiter} (shared across gateway instances via
 * Upstash Redis REST), while dev/test use {@link MemoryRateLimiter}. When the
 * budget is exceeded the gateway responds 429 with a `Retry-After` header.
 */
import type { AppConfig } from "@lms/config";
import {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  type RateLimiter,
} from "@lms/ratelimit";
import type { TenantContext } from "@lms/types";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

// Re-export the limiter core so existing gateway imports (`./ratelimit.js`)
// remain stable after the extraction to `@lms/ratelimit`.
export {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  MemoryRateLimiter,
  UpstashRateLimiter,
  createRateLimiter,
} from "@lms/ratelimit";
export type { RateLimitResult, RateLimiter } from "@lms/ratelimit";

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
