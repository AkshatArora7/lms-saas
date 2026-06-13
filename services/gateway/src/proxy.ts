/**
 * Gateway reverse proxy.
 *
 * After {@link authGuard} authenticates a request and resolves its tenant, the
 * gateway forwards it to the owning domain service. Two security invariants:
 *   1. The client's Authorization header is never forwarded — internal services
 *      trust the gateway, which injects the verified `x-tenant-id` itself.
 *   2. A client-supplied `x-tenant-id` is always overwritten with the value the
 *      gateway resolved from the token, so a caller can never spoof a tenant.
 *
 * Upstream resolution and the HTTP client are injected so routing is unit
 * testable without standing up the 20+ domain services.
 */
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";

/** Resolve a service key (e.g. "course") to its base URL, or null if unknown. */
export type UpstreamResolver = (service: string) => string | null;

export interface ProxyOptions {
  resolveUpstream: UpstreamResolver;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Headers we never forward upstream (hop-by-hop or gateway-managed). */
const STRIP_REQUEST_HEADERS = new Set([
  "authorization",
  "host",
  "connection",
  "content-length",
  "x-tenant-id",
]);

function buildUpstreamUrl(
  base: string,
  rest: string,
  search: string,
): string {
  const trimmed = base.replace(/\/$/, "");
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  return `${trimmed}${path}${search}`;
}

/**
 * Build a Fastify handler that proxies `/api/:service/*` to the resolved
 * upstream. Must be registered behind the auth pre-handler so `req.tenant` is
 * populated.
 */
export function createProxyHandler(options: ProxyOptions): RouteHandlerMethod {
  const doFetch = options.fetchImpl ?? fetch;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { service?: string; "*"?: string };
    const service = params.service ?? "";
    const base = options.resolveUpstream(service);
    if (!base) {
      return reply.code(404).send({
        error: "unknown_service",
        message: `No upstream registered for '${service}'.`,
      });
    }
    if (!req.tenant) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Authentication is required.",
      });
    }

    const qIndex = req.url.indexOf("?");
    const search = qIndex >= 0 ? req.url.slice(qIndex) : "";
    const target = buildUpstreamUrl(base, params["*"] ?? "", search);

    // Forward a clean header set, then stamp the trusted tenant.
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
      headers[key] = Array.isArray(value) ? value.join(",") : String(value);
    }
    headers["x-tenant-id"] = req.tenant.tenantId;

    const method = req.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";
    const body =
      hasBody && req.body != null
        ? typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body)
        : undefined;
    if (body != null && headers["content-type"] == null) {
      headers["content-type"] = "application/json";
    }

    let upstream: Response;
    try {
      upstream = await doFetch(target, { method, headers, body });
    } catch (err) {
      req.log.error({ err, target }, "upstream request failed");
      return reply.code(502).send({
        error: "bad_gateway",
        message: "The upstream service is unavailable.",
      });
    }

    const payload = await upstream.text();
    reply.code(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) reply.header("content-type", contentType);
    return reply.send(payload);
  };
}

/**
 * Resolver backed by env vars: `SERVICE_URL_<SERVICE>` (uppercased), e.g.
 * `SERVICE_URL_COURSE=http://course:4007`. Unset services resolve to null so
 * the proxy returns 404 rather than guessing.
 */
export function envUpstreamResolver(
  env: NodeJS.ProcessEnv = process.env,
): UpstreamResolver {
  return (service) => {
    if (!/^[a-z0-9-]+$/i.test(service)) return null;
    const key = `SERVICE_URL_${service.toUpperCase().replace(/-/g, "_")}`;
    return env[key] ?? null;
  };
}
