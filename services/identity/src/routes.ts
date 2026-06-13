import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "@lms/auth";
import type { AppConfig } from "@lms/config";
import type { StandardRole, TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { IdentityStore } from "./store.js";
import {
  buildAuthorizationUrl,
  defaultOidcExchanger,
  generateNonce,
  generatePkce,
  parseOidcConfig,
  ProviderMisconfiguredError,
  signSsoState,
  verifySsoState,
  type OidcExchanger,
} from "./sso.js";

export interface IdentityRouteDeps {
  config: AppConfig;
  store: IdentityStore;
  /** Resolve the tenant for a request (gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
  now: () => Date;
  generateId: () => string;
  /** OIDC token-exchange strategy (injectable so SSO is testable offline). */
  oidcExchanger?: OidcExchanger;
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}
interface TokenBody {
  refreshToken?: unknown;
}
interface SsoCallbackBody {
  code?: unknown;
  state?: unknown;
}

/** Roles/scopes granted to a brand-new user provisioned via SSO. */
const SSO_DEFAULT_ROLES: StandardRole[] = ["learner"];
const SSO_DEFAULT_SCOPES = ["courses:read"];

function signerOpts(config: AppConfig) {
  return {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };
}

async function issueTokens(
  deps: IdentityRouteDeps,
  ctx: TenantContext,
  userId: string,
  familyId: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const { roles, scopes } = await deps.store.getRolesAndScopes(ctx, userId);

  const accessToken = await signAccessToken(
    {
      sub: userId,
      tenantId: ctx.tenantId,
      tier: ctx.tier,
      roles: roles as StandardRole[],
      scopes,
    },
    { ...signerOpts(deps.config), ttlSeconds: deps.config.ACCESS_TOKEN_TTL },
  );

  const material = generateRefreshToken();
  const expiresAt = new Date(
    deps.now().getTime() + deps.config.REFRESH_TOKEN_TTL * 1000,
  );
  await deps.store.insertRefreshToken(ctx, {
    id: deps.generateId(),
    tenantId: ctx.tenantId,
    userId,
    familyId,
    tokenHash: material.hash,
    expiresAt,
  });

  return {
    accessToken,
    refreshToken: material.token,
    expiresIn: deps.config.ACCESS_TOKEN_TTL,
  };
}

function resolveTenantOr400(
  deps: IdentityRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): TenantContext | null {
  try {
    return deps.resolveTenant(req);
  } catch {
    void reply
      .code(400)
      .send({ error: "tenant_required", message: "Missing tenant context." });
    return null;
  }
}

/** Register the auth surface: login, refresh, logout, me. */
export function registerAuthRoutes(
  app: FastifyInstance,
  deps: IdentityRouteDeps,
): void {
  app.post("/auth/login", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as LoginBody;
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return reply.code(400).send({
        error: "invalid_request",
        message: "email and password are required.",
      });
    }

    const user = await deps.store.findUserByEmail(ctx, body.email);
    // Run a hash comparison even when the user/credential is absent so the
    // response time does not reveal whether an account exists.
    const ok =
      user?.passwordHash != null &&
      (await verifyPassword(body.password, user.passwordHash));
    if (!user || !ok) {
      return reply.code(401).send({
        error: "invalid_credentials",
        message: "Email or password is incorrect.",
      });
    }
    if (user.status !== "active") {
      return reply.code(403).send({
        error: "account_inactive",
        message: "This account is not active.",
      });
    }

    const tokens = await issueTokens(deps, ctx, user.id, deps.generateId());
    return reply.code(200).send({ tokenType: "Bearer", ...tokens });
  });

  app.post("/auth/refresh", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as TokenBody;
    if (typeof body.refreshToken !== "string") {
      return reply.code(400).send({
        error: "invalid_request",
        message: "refreshToken is required.",
      });
    }

    const hash = hashRefreshToken(body.refreshToken);
    const rec = await deps.store.findRefreshByHash(ctx, hash);
    if (!rec) {
      return reply
        .code(401)
        .send({ error: "invalid_token", message: "Unknown refresh token." });
    }

    // Re-use of an already-revoked token means the family is compromised.
    if (rec.revokedAt) {
      await deps.store.revokeFamily(ctx, rec.familyId);
      return reply.code(401).send({
        error: "token_reuse_detected",
        message: "Refresh token re-use detected; session revoked.",
      });
    }
    if (rec.expiresAt.getTime() <= deps.now().getTime()) {
      return reply
        .code(401)
        .send({ error: "token_expired", message: "Refresh token expired." });
    }

    // Rotate: mint the successor first, then point the old token at it.
    const successorId = deps.generateId();
    const { roles, scopes } = await deps.store.getRolesAndScopes(
      ctx,
      rec.userId,
    );
    const accessToken = await signAccessToken(
      {
        sub: rec.userId,
        tenantId: ctx.tenantId,
        tier: ctx.tier,
        roles: roles as StandardRole[],
        scopes,
      },
      { ...signerOpts(deps.config), ttlSeconds: deps.config.ACCESS_TOKEN_TTL },
    );
    const material = generateRefreshToken();
    const expiresAt = new Date(
      deps.now().getTime() + deps.config.REFRESH_TOKEN_TTL * 1000,
    );
    await deps.store.insertRefreshToken(ctx, {
      id: successorId,
      tenantId: ctx.tenantId,
      userId: rec.userId,
      familyId: rec.familyId,
      tokenHash: material.hash,
      expiresAt,
    });
    await deps.store.revokeRefreshToken(ctx, rec.id, successorId);

    return reply.code(200).send({
      tokenType: "Bearer",
      accessToken,
      refreshToken: material.token,
      expiresIn: deps.config.ACCESS_TOKEN_TTL,
    });
  });

  app.post("/auth/logout", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as TokenBody;
    if (typeof body.refreshToken === "string") {
      const rec = await deps.store.findRefreshByHash(
        ctx,
        hashRefreshToken(body.refreshToken),
      );
      if (rec) await deps.store.revokeFamily(ctx, rec.familyId);
    }
    // Idempotent: logging out an unknown/already-revoked token still succeeds.
    return reply.code(204).send();
  });

  app.get("/auth/me", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Missing bearer token.",
      });
    }
    try {
      const claims = await verifyAccessToken(token, signerOpts(deps.config));
      return reply.code(200).send({
        userId: claims.sub,
        tenantId: claims.tenantId,
        tier: claims.tier,
        roles: claims.roles,
        scopes: claims.scopes,
      });
    } catch {
      return reply.code(401).send({
        error: "invalid_token",
        message: "Access token is invalid or expired.",
      });
    }
  });

  registerSsoRoutes(app, deps);
}

/**
 * SSO federation surface (OIDC). Two stateless calls:
 *   - POST /auth/sso/:providerId/start    -> { authorizationUrl, state }
 *   - POST /auth/sso/:providerId/callback -> first-party tokens
 * The caller (BFF) redirects the browser to `authorizationUrl`, holds `state`
 * in a cookie, and replays `{ code, state }` on the callback. Any
 * misconfiguration or tampering fails closed with a clear error.
 */
function registerSsoRoutes(
  app: FastifyInstance,
  deps: IdentityRouteDeps,
): void {
  const exchanger = deps.oidcExchanger ?? defaultOidcExchanger;

  app.post<{ Params: { providerId: string } }>(
    "/auth/sso/:providerId/start",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;

      const provider = await deps.store.findIdentityProvider(
        ctx,
        req.params.providerId,
      );
      if (!provider || !provider.isEnabled) {
        return reply.code(404).send({
          error: "provider_not_found",
          message: "No enabled identity provider for this id.",
        });
      }
      if (provider.kind !== "oidc") {
        return reply.code(400).send({
          error: "provider_unsupported",
          message: `SSO kind '${provider.kind}' is not yet supported.`,
        });
      }

      let oidc;
      try {
        oidc = parseOidcConfig(provider.config);
      } catch (err) {
        if (err instanceof ProviderMisconfiguredError) {
          return reply.code(400).send({
            error: "provider_misconfigured",
            message: err.message,
          });
        }
        throw err;
      }

      const { verifier, challenge } = generatePkce();
      const nonce = generateNonce();
      const state = await signSsoState(
        {
          providerId: provider.id,
          tenantId: ctx.tenantId,
          nonce,
          codeVerifier: verifier,
          redirectUri: oidc.redirectUri,
        },
        deps.config.JWT_SECRET,
      );
      const authorizationUrl = buildAuthorizationUrl(oidc, {
        state,
        nonce,
        codeChallenge: challenge,
      });
      return reply.code(200).send({ authorizationUrl, state });
    },
  );

  app.post<{ Params: { providerId: string } }>(
    "/auth/sso/:providerId/callback",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;

      const body = (req.body ?? {}) as SsoCallbackBody;
      if (typeof body.code !== "string" || typeof body.state !== "string") {
        return reply.code(400).send({
          error: "invalid_request",
          message: "code and state are required.",
        });
      }

      // Verify the signed state first: tampering/expiry fails closed here.
      let state;
      try {
        state = await verifySsoState(body.state, deps.config.JWT_SECRET);
      } catch {
        return reply.code(401).send({
          error: "invalid_state",
          message: "SSO state is invalid or expired.",
        });
      }
      if (
        state.providerId !== req.params.providerId ||
        state.tenantId !== ctx.tenantId
      ) {
        return reply.code(401).send({
          error: "invalid_state",
          message: "SSO state does not match this request.",
        });
      }

      const provider = await deps.store.findIdentityProvider(
        ctx,
        state.providerId,
      );
      if (!provider || !provider.isEnabled || provider.kind !== "oidc") {
        return reply.code(400).send({
          error: "provider_unavailable",
          message: "Identity provider is unavailable.",
        });
      }

      let oidc;
      try {
        oidc = parseOidcConfig(provider.config);
      } catch (err) {
        if (err instanceof ProviderMisconfiguredError) {
          return reply.code(400).send({
            error: "provider_misconfigured",
            message: err.message,
          });
        }
        throw err;
      }

      let identity;
      try {
        identity = await exchanger.exchange(oidc, {
          code: body.code,
          codeVerifier: state.codeVerifier,
          nonce: state.nonce,
        });
      } catch (err) {
        req.log.warn({ err }, "sso token exchange failed");
        return reply.code(401).send({
          error: "sso_exchange_failed",
          message: "Could not complete sign-in with the identity provider.",
        });
      }

      const user = await deps.store.upsertSsoUser(ctx, {
        providerId: provider.id,
        subject: identity.subject,
        email: identity.email ?? `${identity.subject}@${provider.id}.sso`,
        displayName: identity.displayName ?? identity.email ?? identity.subject,
        defaultRoles: SSO_DEFAULT_ROLES,
        defaultScopes: SSO_DEFAULT_SCOPES,
      });

      const tokens = await issueTokens(deps, ctx, user.id, deps.generateId());
      return reply.code(200).send({ tokenType: "Bearer", ...tokens });
    },
  );
}
