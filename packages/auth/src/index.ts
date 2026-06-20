import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import type { StandardRole, TenantTier } from "@lms/types";

export {
  hashPassword,
  verifyPassword,
} from "./password.js";
export {
  generateRefreshToken,
  hashRefreshToken,
  type RefreshTokenMaterial,
} from "./refresh.js";
export {
  signEmbedToken,
  verifyEmbedToken,
  EMBED_TOKEN_AUDIENCE,
  type EmbedResourceType,
  type EmbedTokenClaims,
  type EmbedTokenSignerOptions,
  type NewEmbedTokenClaims,
} from "./embed.js";

/**
 * Access-token claims carried on every authenticated request.
 * tenant_id + tier let the gateway route to the correct (pool/silo) database
 * without an extra lookup.
 */
export interface AccessTokenClaims extends JWTPayload {
  sub: string; // user id
  tenantId: string;
  /**
   * The owning parent tenant for a sub-tenant, or null for a top-level tenant.
   * Carried in the token so downstream services authorize across the tenant
   * hierarchy without a control-plane round-trip.
   */
  parentTenantId: string | null;
  tier: TenantTier;
  roles: StandardRole[];
  /** Granular permission strings, e.g. "discussions:posts:manage". */
  scopes: string[];
}

export interface TokenSignerOptions {
  secret: string;
  issuer?: string;
  audience?: string;
  ttlSeconds?: number;
}

export async function signAccessToken(
  claims: Omit<AccessTokenClaims, "iat" | "exp" | "iss" | "aud">,
  opts: TokenSignerOptions,
): Promise<string> {
  const key = new TextEncoder().encode(opts.secret);
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${opts.ttlSeconds ?? 900}s`);
  if (opts.issuer) jwt.setIssuer(opts.issuer);
  if (opts.audience) jwt.setAudience(opts.audience);
  return jwt.sign(key);
}

export async function verifyAccessToken(
  token: string,
  opts: Pick<TokenSignerOptions, "secret" | "issuer" | "audience">,
): Promise<AccessTokenClaims> {
  const key = new TextEncoder().encode(opts.secret);
  const { payload } = await jwtVerify(token, key, {
    issuer: opts.issuer,
    audience: opts.audience,
  });
  return payload as AccessTokenClaims;
}

/** Coarse permission check used by service guards. */
export function hasScope(
  claims: AccessTokenClaims,
  required: string,
): boolean {
  if (claims.roles.includes("super_admin")) return true;
  return claims.scopes.includes(required);
}
