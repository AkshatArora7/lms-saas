import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Embed tokens authorize a school portal to frame a single LMS resource inside
 * an iframe. They are deliberately a *different* token family from access
 * tokens (issue #13):
 *
 * - A distinct audience (`lms-embed`) so an access token can never be replayed
 *   as an embed token, and vice versa.
 * - Short-lived by default (5 minutes) — the portal mints one server-side right
 *   before rendering the iframe; it is not a session.
 * - Self-describing: the token carries the tenant, the resource, and the
 *   origins permitted to frame it, so the widget render path enforces scope and
 *   `frame-ancestors` purely from the signed claims — no database lookup, no
 *   way to leak across tenants.
 */
export type EmbedResourceType = "course" | "dashboard" | "widget";

/** Default audience that distinguishes embed tokens from API access tokens. */
export const EMBED_TOKEN_AUDIENCE = "lms-embed";

export interface EmbedTokenClaims extends JWTPayload {
  /** Tenant the embedded resource belongs to. This is the isolation boundary. */
  tenantId: string;
  resourceType: EmbedResourceType;
  resourceId: string;
  /** Display label rendered in the widget (carried so the render path needs no DB). */
  title?: string;
  subtitle?: string;
  /**
   * Origins permitted to frame the widget, e.g. `https://portal.school.edu`.
   * Enforced as the `frame-ancestors` CSP directive on the widget response.
   */
  allowedOrigins: string[];
}

export interface EmbedTokenSignerOptions {
  secret: string;
  issuer?: string;
  audience?: string;
  /** Lifetime in seconds; defaults to 300 (5 minutes). */
  ttlSeconds?: number;
}

export type NewEmbedTokenClaims = Omit<
  EmbedTokenClaims,
  "iat" | "exp" | "iss" | "aud"
>;

/** Mint a signed, short-lived embed token scoped to a tenant + resource. */
export async function signEmbedToken(
  claims: NewEmbedTokenClaims,
  opts: EmbedTokenSignerOptions,
): Promise<string> {
  const key = new TextEncoder().encode(opts.secret);
  const jwt = new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${opts.ttlSeconds ?? 300}s`)
    .setAudience(opts.audience ?? EMBED_TOKEN_AUDIENCE);
  if (opts.issuer) jwt.setIssuer(opts.issuer);
  return jwt.sign(key);
}

/**
 * Verify an embed token. Throws (jose error) if the signature is invalid, the
 * token is expired, or the audience/issuer do not match — so the widget route
 * fails closed.
 */
export async function verifyEmbedToken(
  token: string,
  opts: Pick<EmbedTokenSignerOptions, "secret" | "issuer" | "audience">,
): Promise<EmbedTokenClaims> {
  const key = new TextEncoder().encode(opts.secret);
  const { payload } = await jwtVerify(token, key, {
    audience: opts.audience ?? EMBED_TOKEN_AUDIENCE,
    ...(opts.issuer ? { issuer: opts.issuer } : {}),
  });
  return payload as EmbedTokenClaims;
}
