import { signEmbedToken, verifyEmbedToken } from "@lms/auth";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  iframeSnippet,
  isEmbedResourceType,
  isValidOrigin,
  renderWidgetHtml,
  widgetCsp,
} from "./embed.js";

export interface EmbedRouteDeps {
  /** Resolves the calling tenant for the mint endpoint (gateway forwards it). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
  /** HS256 secret shared with the rest of the auth surface. */
  secret: string;
  /** Optional issuer stamped into / verified on embed tokens. */
  issuer?: string;
  /** Absolute base URL the widget is served from (to build embed URLs). */
  publicBaseUrl?: string;
  /** Base URL of the learner app the widget links out to. */
  launchBaseUrl?: string;
}

/** Default token lifetime and the accepted range (seconds). */
const DEFAULT_TTL = 300;
const MIN_TTL = 30;
const MAX_TTL = 3600;

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Embeddable course/widget surface (issue #13).
 *
 * - `POST /embed/tokens` — authenticated (tenant comes from the gateway) mint of
 *   a short-lived signed token scoped to one tenant + resource + allowed origins.
 * - `GET  /embed/widget` — public render path: it trusts only the signed token,
 *   sets `frame-ancestors` from the token's origins, and renders the widget.
 *   There is no tenant query here, so it cannot leak another tenant's data.
 */
export function registerEmbedRoutes(
  app: FastifyInstance,
  deps: EmbedRouteDeps,
): void {
  const verifyOpts = {
    secret: deps.secret,
    ...(deps.issuer ? { issuer: deps.issuer } : {}),
  };

  app.post("/embed/tokens", async (req, reply) => {
    let ctx: TenantContext;
    try {
      ctx = deps.resolveTenant(req);
    } catch {
      return reply
        .code(400)
        .send({ error: "tenant_required", message: "Missing tenant context." });
    }

    const body = (req.body ?? {}) as {
      resourceType?: unknown;
      resourceId?: unknown;
      title?: unknown;
      subtitle?: unknown;
      allowedOrigins?: unknown;
      ttlSeconds?: unknown;
    };

    if (!isEmbedResourceType(body.resourceType)) {
      return badRequest(
        reply,
        "resourceType must be one of: course, dashboard, widget.",
      );
    }
    if (!isNonEmptyString(body.resourceId)) {
      return badRequest(reply, "resourceId is required.");
    }
    if (
      !Array.isArray(body.allowedOrigins) ||
      body.allowedOrigins.length === 0
    ) {
      return badRequest(
        reply,
        "allowedOrigins must be a non-empty array of origins.",
      );
    }
    if (!body.allowedOrigins.every(isValidOrigin)) {
      return badRequest(
        reply,
        "Each allowedOrigin must be an https origin (scheme://host[:port]) with no path; http is permitted only for localhost.",
      );
    }

    let ttlSeconds = DEFAULT_TTL;
    if (body.ttlSeconds !== undefined) {
      const n = Number(body.ttlSeconds);
      if (!Number.isInteger(n) || n < MIN_TTL || n > MAX_TTL) {
        return badRequest(
          reply,
          `ttlSeconds must be an integer between ${MIN_TTL} and ${MAX_TTL}.`,
        );
      }
      ttlSeconds = n;
    }

    const token = await signEmbedToken(
      {
        tenantId: ctx.tenantId,
        resourceType: body.resourceType,
        resourceId: body.resourceId.trim(),
        allowedOrigins: body.allowedOrigins,
        ...(isNonEmptyString(body.title) ? { title: body.title.trim() } : {}),
        ...(isNonEmptyString(body.subtitle)
          ? { subtitle: body.subtitle.trim() }
          : {}),
      },
      {
        secret: deps.secret,
        ttlSeconds,
        ...(deps.issuer ? { issuer: deps.issuer } : {}),
      },
    );

    const base = (deps.publicBaseUrl ?? "").replace(/\/$/, "");
    const embedUrl = `${base}/embed/widget?token=${encodeURIComponent(token)}`;

    return reply.code(201).send({
      token,
      embedUrl,
      iframe: iframeSnippet(embedUrl, body.resourceType),
      expiresIn: ttlSeconds,
    });
  });

  app.get<{ Querystring: { token?: string } }>(
    "/embed/widget",
    async (req, reply) => {
      const token = req.query.token;
      if (!isNonEmptyString(token)) {
        return badRequest(reply, "token query parameter is required.");
      }

      let claims;
      try {
        claims = await verifyEmbedToken(token, verifyOpts);
      } catch {
        return reply
          .code(401)
          .send({ error: "invalid_token", message: "Invalid or expired embed token." });
      }

      const html = renderWidgetHtml(claims, {
        ...(deps.launchBaseUrl ? { launchBaseUrl: deps.launchBaseUrl } : {}),
      });

      // frame-ancestors (from the signed origins) is the modern replacement for
      // X-Frame-Options and is the only thing that can express multiple origins.
      return reply
        .code(200)
        .header("content-type", "text/html; charset=utf-8")
        .header("content-security-policy", widgetCsp(claims.allowedOrigins))
        .header("cache-control", "no-store")
        .header("referrer-policy", "no-referrer")
        .send(html);
    },
  );
}
