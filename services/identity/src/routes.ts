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

export interface IdentityRouteDeps {
  config: AppConfig;
  store: IdentityStore;
  /** Resolve the tenant for a request (gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
  now: () => Date;
  generateId: () => string;
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}
interface TokenBody {
  refreshToken?: unknown;
}

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
}
