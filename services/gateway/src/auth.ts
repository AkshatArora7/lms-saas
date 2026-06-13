/**
 * Gateway authentication & tenant resolution.
 *
 * Every request that reaches a domain service is first authenticated here: the
 * bearer access token (issued by the identity service via password login or SSO)
 * is verified, and the tenant it belongs to is resolved into a TenantContext.
 * The gateway then forwards `x-tenant-id` downstream so each service runs its
 * work through RLS-scoped `withTenant`. This keeps tenant resolution in exactly
 * one place instead of trusting a client-supplied header.
 */
import {
  hasScope,
  verifyAccessToken,
  type AccessTokenClaims,
} from "@lms/auth";
import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Verified access-token claims, set by the auth pre-handler. */
    claims?: AccessTokenClaims;
    /** Tenant resolved from the verified claims. */
    tenant?: TenantContext;
  }
}

/** Pull the bearer token from the Authorization header. */
export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/** Verify the request's access token, returning its claims (or throwing). */
export async function verifyRequest(
  req: FastifyRequest,
  config: AppConfig,
): Promise<AccessTokenClaims> {
  const token = bearerToken(req);
  if (!token) throw new Error("missing bearer token");
  return verifyAccessToken(token, {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
}

/**
 * Build a TenantContext from verified claims. The tenant id and tier are
 * carried in the token, so no extra lookup is needed for pool tenants; silo
 * connection strings are resolved upstream from the control plane (out of scope
 * here, so we fall back to the shared DATABASE_URL).
 */
export function tenantFromClaims(
  claims: AccessTokenClaims,
  config: AppConfig,
): TenantContext {
  return {
    tenantId: claims.tenantId,
    tier: claims.tier,
    databaseUrl: config.DATABASE_URL,
  };
}

/**
 * Pre-handler that authenticates the request, attaches `claims` + `tenant`, and
 * forwards the resolved tenant to downstream services via `x-tenant-id`.
 * Responds 401 (fail closed) when the token is missing or invalid.
 */
export function authGuard(config: AppConfig): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    let claims: AccessTokenClaims;
    try {
      claims = await verifyRequest(req, config);
    } catch {
      return reply.code(401).send({
        error: "unauthorized",
        message: "A valid bearer token is required.",
      });
    }
    req.claims = claims;
    req.tenant = tenantFromClaims(claims, config);
    // Trusted, gateway-resolved tenant for downstream RLS scoping.
    req.headers["x-tenant-id"] = claims.tenantId;
  };
}

/**
 * Pre-handler factory that enforces a permission scope. Must run after
 * {@link authGuard} (it reads `req.claims`). Responds 403 when the scope is
 * absent (super_admin bypasses via {@link hasScope}).
 */
export function requireScope(scope: string): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const claims = req.claims;
    if (!claims) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Authentication is required.",
      });
    }
    if (!hasScope(claims, scope)) {
      return reply.code(403).send({
        error: "forbidden",
        message: `Missing required scope: ${scope}`,
      });
    }
  };
}
