/**
 * OIDC SSO federation primitives for the identity service.
 *
 * The flow is split across two stateless HTTP calls (start + callback). Rather
 * than keep server-side session state between them, we carry a short-lived
 * signed "state" token (HS256, JWT_SECRET) that embeds the PKCE verifier and
 * nonce. The BFF stores it (cookie) and replays it on the callback, so any
 * tampering or replay fails closed at verification time.
 *
 * The token-exchange step is expressed as an injectable {@link OidcExchanger}
 * so the routes can be tested end-to-end without reaching a real IdP. The
 * default implementation performs the standard authorization-code (+PKCE)
 * exchange and verifies the returned id_token against the provider's JWKS.
 */
import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

/** Normalised OIDC settings parsed from `identity_provider.config` (jsonb). */
export interface OidcProviderConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
}

/** Identity resolved from a verified id_token. */
export interface OidcIdentity {
  subject: string;
  email?: string;
  displayName?: string;
}

/** Payload embedded in the signed SSO state token. */
export interface SsoState {
  providerId: string;
  tenantId: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}

/** Thrown when a provider's stored config is missing required OIDC fields. */
export class ProviderMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderMisconfiguredError";
  }
}

const DEFAULT_SCOPES = ["openid", "email", "profile"];

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse and validate the jsonb provider config into a typed OIDC config.
 * Throws {@link ProviderMisconfiguredError} (login fails closed) when a
 * required endpoint or client id is absent.
 */
export function parseOidcConfig(
  raw: Record<string, unknown>,
): OidcProviderConfig {
  const authorizationEndpoint = asString(raw.authorizationEndpoint);
  const tokenEndpoint = asString(raw.tokenEndpoint);
  const jwksUri = asString(raw.jwksUri);
  const clientId = asString(raw.clientId);
  const redirectUri = asString(raw.redirectUri);
  const issuer = asString(raw.issuer) ?? authorizationEndpoint ?? "";

  const missing: string[] = [];
  if (!authorizationEndpoint) missing.push("authorizationEndpoint");
  if (!tokenEndpoint) missing.push("tokenEndpoint");
  if (!jwksUri) missing.push("jwksUri");
  if (!clientId) missing.push("clientId");
  if (!redirectUri) missing.push("redirectUri");
  if (missing.length > 0) {
    throw new ProviderMisconfiguredError(
      `OIDC provider config is missing: ${missing.join(", ")}`,
    );
  }

  const scopes = Array.isArray(raw.scopes)
    ? raw.scopes.filter((s): s is string => typeof s === "string")
    : DEFAULT_SCOPES;

  return {
    issuer,
    authorizationEndpoint: authorizationEndpoint!,
    tokenEndpoint: tokenEndpoint!,
    jwksUri: jwksUri!,
    clientId: clientId!,
    clientSecret: asString(raw.clientSecret),
    redirectUri: redirectUri!,
    scopes: scopes.length > 0 ? scopes : DEFAULT_SCOPES,
  };
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Generate a PKCE verifier and its S256 challenge (RFC 7636). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** A random, URL-safe nonce for replay protection of the id_token. */
export function generateNonce(): string {
  return base64Url(randomBytes(16));
}

const STATE_AUDIENCE = "lms-sso-state";

/** Sign the SSO state into a short-lived JWT carried by the BFF. */
export async function signSsoState(
  state: SsoState,
  secret: string,
  ttlSeconds = 600,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

/** Verify and decode a signed SSO state token (throws if tampered/expired). */
export async function verifySsoState(
  token: string,
  secret: string,
): Promise<SsoState> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, {
    audience: STATE_AUDIENCE,
  });
  const { providerId, tenantId, nonce, codeVerifier, redirectUri } =
    payload as Record<string, unknown>;
  if (
    typeof providerId !== "string" ||
    typeof tenantId !== "string" ||
    typeof nonce !== "string" ||
    typeof codeVerifier !== "string" ||
    typeof redirectUri !== "string"
  ) {
    throw new Error("malformed sso state");
  }
  return { providerId, tenantId, nonce, codeVerifier, redirectUri };
}

/** Build the IdP authorization URL (authorization-code flow + PKCE). */
export function buildAuthorizationUrl(
  config: OidcProviderConfig,
  params: { state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Exchanges an authorization code for a verified end-user identity. */
export interface OidcExchanger {
  exchange(
    config: OidcProviderConfig,
    params: { code: string; codeVerifier: string; nonce: string },
  ): Promise<OidcIdentity>;
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
}

/**
 * Default exchanger: POST the code to the token endpoint, then verify the
 * id_token signature/claims against the provider JWKS and the expected nonce.
 */
export const defaultOidcExchanger: OidcExchanger = {
  async exchange(config, params) {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: params.codeVerifier,
    });
    if (config.clientSecret) form.set("client_secret", config.clientSecret);

    const res = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new Error(`token endpoint returned ${res.status}`);
    }
    const tokens = (await res.json()) as TokenResponse;
    if (!tokens.id_token) {
      throw new Error("token response did not include an id_token");
    }

    const jwks = createRemoteJWKSet(new URL(config.jwksUri));
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
    });
    if (payload.nonce !== params.nonce) {
      throw new Error("id_token nonce mismatch");
    }
    const subject = asString(payload.sub);
    if (!subject) throw new Error("id_token is missing sub");

    return {
      subject,
      email: asString(payload.email),
      displayName:
        asString(payload.name) ??
        asString(payload.preferred_username) ??
        asString(payload.email),
    };
  },
};
