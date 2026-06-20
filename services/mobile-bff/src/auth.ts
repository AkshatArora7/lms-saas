/**
 * Mobile BFF authentication — the *same token model* as the rest of the platform
 * (issue #79). The React Native app sends the bearer access token issued by the
 * identity service; the BFF verifies it with the shared secret/issuer/audience
 * (identical to the gateway), extracts the caller, and forwards the same token
 * upstream. No separate session or token family.
 */
import { verifyAccessToken, type AccessTokenClaims } from "@lms/auth";
import type { AppConfig } from "@lms/config";
import type { FastifyReply, FastifyRequest } from "fastify";

import { bearerToken, type UpstreamContext } from "./upstream.js";

export interface AuthedRequest {
  claims: AccessTokenClaims;
  ctx: UpstreamContext;
}

/**
 * Verify the request's bearer token and build an UpstreamContext, or send a 401
 * (fail closed) and return null. Routes call this first.
 */
export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
): Promise<AuthedRequest | null> {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    void reply
      .code(401)
      .send({ error: "unauthorized", message: "A bearer token is required." });
    return null;
  }
  let claims: AccessTokenClaims;
  try {
    claims = await verifyAccessToken(token, {
      secret: config.JWT_SECRET,
      ...(config.JWT_ISSUER ? { issuer: config.JWT_ISSUER } : {}),
      audience: config.JWT_AUDIENCE,
    });
  } catch {
    void reply.code(401).send({
      error: "unauthorized",
      message: "The bearer token is invalid or expired.",
    });
    return null;
  }
  return {
    claims,
    ctx: { token, tenantId: claims.tenantId, userId: claims.sub },
  };
}
