import { randomUUID } from "node:crypto";

import { signAccessToken } from "@lms/auth";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify } from "jose";

import {
  validateLaunchClaims,
  type Clock,
  type JwksResolverFactory,
} from "./lti.js";
import type { LtiStore } from "./store.js";

export interface LtiRouteDeps {
  /** Resolves the calling tenant (gateway forwards it as x-tenant-id). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
  store: LtiStore;
  /** Builds a JWKS key resolver per registration jwks_url. */
  jwksFactory: JwksResolverFactory;
  /** Single source of "now" (injected for deterministic tests). */
  clock: Clock;
  /** HS256 secret used to mint the LMS session token. */
  secret: string;
  /** Optional issuer stamped on the minted session token. */
  issuer?: string;
  /** Audience for the minted session token (the LMS API). */
  audience?: string;
  /** Base URL of the learner app the launch redirects into. */
  launchBaseUrl?: string;
  /** Absolute base URL of THIS service (to build the OIDC redirect_uri). */
  publicBaseUrl?: string;
  /** Minted session lifetime (seconds). */
  sessionTtlSeconds?: number;
}

const DEFAULT_SESSION_TTL = 900;
/** Cookie the learner app reads the minted session from. */
const SESSION_COOKIE = "lms_session";

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function unauthorized(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(401).send({ error: "invalid_token", message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Accept login/launch params from either query string or a form body. */
function param(req: FastifyRequest, key: string): string | undefined {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const v = b[key] ?? q[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function resolveTenantOr400(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: LtiRouteDeps,
): TenantContext | null {
  try {
    return deps.resolveTenant(req);
  } catch {
    reply
      .code(400)
      .send({ error: "tenant_required", message: "Missing tenant context." });
    return null;
  }
}

/**
 * LTI 1.3 Tool launch surface (issue #10). This LMS is the Tool; a school portal
 * Platform initiates an OIDC third-party login (/lti/login) and posts back a
 * signed id_token (/lti/launch). embed.* routes are untouched — additive only.
 */
export function registerLtiRoutes(app: FastifyInstance, deps: LtiRouteDeps): void {
  const sessionTtl = deps.sessionTtlSeconds ?? DEFAULT_SESSION_TTL;
  const redirectUri = `${(deps.publicBaseUrl ?? "").replace(/\/$/, "")}/lti/launch`;

  // The platform posts the OIDC callback as application/x-www-form-urlencoded
  // (response_mode=form_post). Fastify only parses JSON by default, so register
  // a minimal urlencoded body parser (idempotent if already present).
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          const params = new URLSearchParams(body as string);
          done(null, Object.fromEntries(params.entries()));
        } catch (err) {
          done(err as Error);
        }
      },
    );
  }

  // --- OIDC third-party-initiated login ------------------------------------
  const login = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveTenantOr400(req, reply, deps);
    if (!ctx) return reply;

    const issuer = param(req, "iss");
    const clientId = param(req, "client_id");
    const loginHint = param(req, "login_hint");
    if (!issuer || !clientId) {
      return badRequest(reply, "iss and client_id are required.");
    }

    const registration = await deps.store.findRegistration(ctx, issuer, clientId);
    if (!registration) {
      return reply
        .code(404)
        .send({ error: "unknown_registration", message: "No registration for (iss, client_id)." });
    }

    const state = randomUUID();
    const nonce = randomUUID();
    const targetLinkUri = param(req, "target_link_uri") ?? null;
    const ltiMessageHint = param(req, "lti_message_hint") ?? null;

    await deps.store.createLaunchSession(ctx, {
      registrationId: registration.id,
      state,
      nonce,
      targetLinkUri,
      ltiMessageHint,
    });

    const auth = new URL(registration.authLoginUrl);
    auth.searchParams.set("scope", "openid");
    auth.searchParams.set("response_type", "id_token");
    auth.searchParams.set("response_mode", "form_post");
    auth.searchParams.set("prompt", "none");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("state", state);
    auth.searchParams.set("nonce", nonce);
    if (loginHint) auth.searchParams.set("login_hint", loginHint);
    if (ltiMessageHint) auth.searchParams.set("lti_message_hint", ltiMessageHint);

    return reply.code(302).header("location", auth.toString()).send();
  };

  app.get("/lti/login", login);
  app.post("/lti/login", login);

  // --- OIDC launch callback (form_post) ------------------------------------
  app.post("/lti/launch", async (req, reply) => {
    const ctx = resolveTenantOr400(req, reply, deps);
    if (!ctx) return reply;

    const idToken = param(req, "id_token");
    const state = param(req, "state");
    if (!idToken || !state) {
      return badRequest(reply, "id_token and state are required.");
    }

    // Atomic single-use burn: replay / expiry / unknown state ⇒ 401.
    const session = await deps.store.consumeLaunchSession(ctx, state);
    if (!session) {
      return unauthorized(reply, "Invalid, expired, or already-used launch state.");
    }

    const registration = await deps.store.getRegistrationById(ctx, session.registrationId);
    if (!registration) {
      return unauthorized(reply, "Unknown registration for launch state.");
    }

    const resolver = deps.jwksFactory.forJwksUrl(registration.jwksUrl);
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, resolver, {
        issuer: registration.issuer,
        audience: registration.clientId,
        currentDate: deps.clock(),
      });
      payload = verified.payload as Record<string, unknown>;
    } catch {
      return unauthorized(reply, "id_token signature/claims verification failed.");
    }

    const result = validateLaunchClaims(payload, {
      expectedNonce: session.nonce,
      isKnownDeployment: () => true, // re-checked below against the store
    });
    if (!result.ok) {
      return unauthorized(reply, `Invalid launch claims: ${result.reason}.`);
    }

    const deployment = await deps.store.getDeployment(
      ctx,
      registration.id,
      result.launch.deploymentId,
    );
    if (!deployment) {
      return unauthorized(reply, "Unknown deployment_id for registration.");
    }

    const sessionToken = await signAccessToken(
      {
        sub: result.launch.sub,
        tenantId: ctx.tenantId,
        parentTenantId: ctx.parentTenantId ?? null,
        tier: ctx.tier,
        roles: result.launch.lmsRoles,
        scopes: [],
      },
      {
        secret: deps.secret,
        ttlSeconds: sessionTtl,
        ...(deps.issuer ? { issuer: deps.issuer } : {}),
        ...(deps.audience ? { audience: deps.audience } : {}),
      },
    );

    // Redirect to the learner app with the session in an httpOnly cookie — the
    // token is NEVER placed in the URL.
    const base = (deps.launchBaseUrl ?? "").replace(/\/$/, "");
    const target = result.launch.targetLinkUri ?? session.targetLinkUri ?? "";
    const location = target.startsWith("http")
      ? target
      : `${base}${target.startsWith("/") ? "" : "/"}${target}`;

    const cookie = [
      `${SESSION_COOKIE}=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=None",
      `Max-Age=${sessionTtl}`,
    ].join("; ");

    return reply
      .code(302)
      .header("set-cookie", cookie)
      .header("location", location || base || "/")
      .send();
  });

  // --- Admin: register a platform (tenant-scoped) --------------------------
  app.post("/lti/registrations", async (req, reply) => {
    const ctx = resolveTenantOr400(req, reply, deps);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const issuer = body.issuer;
    const clientId = body.clientId;
    const authLoginUrl = body.authLoginUrl;
    const authTokenUrl = body.authTokenUrl;
    const jwksUrl = body.jwksUrl;
    const role = body.role;

    if (
      !isNonEmptyString(issuer) ||
      !isNonEmptyString(clientId) ||
      !isNonEmptyString(authLoginUrl) ||
      !isNonEmptyString(authTokenUrl) ||
      !isNonEmptyString(jwksUrl)
    ) {
      return badRequest(
        reply,
        "issuer, clientId, authLoginUrl, authTokenUrl, and jwksUrl are required.",
      );
    }
    for (const url of [authLoginUrl, authTokenUrl, jwksUrl]) {
      try {
        void new URL(url);
      } catch {
        return badRequest(reply, `Invalid URL: ${url}`);
      }
    }
    if (role !== undefined && role !== "platform" && role !== "tool") {
      return badRequest(reply, "role must be 'platform' or 'tool'.");
    }

    const registration = await deps.store.createRegistration(ctx, {
      issuer: issuer.trim(),
      clientId: clientId.trim(),
      authLoginUrl: authLoginUrl.trim(),
      authTokenUrl: authTokenUrl.trim(),
      jwksUrl: jwksUrl.trim(),
      role: (role as "platform" | "tool") ?? "platform",
    });

    return reply.code(201).send({ registration });
  });
}
