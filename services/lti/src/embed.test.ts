import { signAccessToken, signEmbedToken, verifyEmbedToken } from "@lms/auth";
import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import {
  frameAncestors,
  isValidOrigin,
  launchUrl,
  renderWidgetHtml,
  widgetCsp,
} from "./embed.js";
import { buildApp } from "./main.js";

const JWT_SECRET = "test-secret-at-least-16-chars-long";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  JWT_SECRET,
  JWT_AUDIENCE: "lms-api",
} as unknown as AppConfig;

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

function build() {
  return buildApp({
    config,
    resolveTenant,
    publicBaseUrl: "https://embed.lms.test",
    launchBaseUrl: "https://app.lms.test",
  });
}

const H = { "x-tenant-id": TENANT_ID };
const ORIGIN = "https://portal.school.edu";

async function mint(
  app: ReturnType<typeof build>,
  payload: Record<string, unknown>,
  headers: Record<string, string> = H,
) {
  return app.inject({ method: "POST", url: "/embed/tokens", headers, payload });
}

describe("origin validation (pure)", () => {
  it("accepts bare https origins and localhost http", () => {
    expect(isValidOrigin("https://portal.school.edu")).toBe(true);
    expect(isValidOrigin("https://portal.school.edu:8443")).toBe(true);
    expect(isValidOrigin("http://localhost:3000")).toBe(true);
  });
  it("rejects wildcards, paths, non-https, and junk", () => {
    expect(isValidOrigin("*")).toBe(false);
    expect(isValidOrigin("https://portal.school.edu/embed")).toBe(false);
    expect(isValidOrigin("http://evil.example")).toBe(false);
    expect(isValidOrigin("https://user:pass@host.example")).toBe(false);
    expect(isValidOrigin("not a url")).toBe(false);
    expect(isValidOrigin("")).toBe(false);
  });
});

describe("widget rendering (pure)", () => {
  it("is responsive, accessible, and escapes injected text", () => {
    const html = renderWidgetHtml(
      {
        resourceType: "course",
        resourceId: "c1",
        title: 'Algebra <script>alert(1)</script> & "more"',
        subtitle: "Spring term",
      },
      { launchBaseUrl: "https://app.lms.test" },
    );
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("width=device-width");
    expect(html).toContain('role="main"');
    expect(html).toContain("min-height: 44px");
    // No raw script tag survives escaping.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });
  it("builds a launch deep link from the resource", () => {
    expect(launchUrl({ resourceType: "course", resourceId: "c 1" }, "https://app.lms.test/")).toBe(
      "https://app.lms.test/launch?type=course&id=c+1",
    );
  });
  it("frame-ancestors always includes self plus the allowed origins", () => {
    expect(frameAncestors([ORIGIN])).toBe(`'self' ${ORIGIN}`);
    expect(widgetCsp([ORIGIN])).toContain(`frame-ancestors 'self' ${ORIGIN}`);
    expect(widgetCsp([ORIGIN])).toContain("default-src 'none'");
  });
});

describe("embed token surface (#13)", () => {
  it("health still reports ok", async () => {
    const res = await build().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("lti");
  });

  it("mints a scoped token and returns an embed url + iframe snippet", async () => {
    const res = await mint(build(), {
      resourceType: "course",
      resourceId: "course-123",
      title: "Intro to Biology",
      allowedOrigins: [ORIGIN],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.embedUrl).toContain("https://embed.lms.test/embed/widget?token=");
    expect(body.iframe).toContain("<iframe");
    expect(body.expiresIn).toBe(300);

    const claims = await verifyEmbedToken(body.token, { secret: JWT_SECRET });
    expect(claims.tenantId).toBe(TENANT_ID);
    expect(claims.resourceId).toBe("course-123");
    expect(claims.allowedOrigins).toEqual([ORIGIN]);
  });

  it("renders the widget with frame-ancestors from the signed origins", async () => {
    const app = build();
    const token = (
      await mint(app, {
        resourceType: "course",
        resourceId: "course-123",
        title: "Intro to Biology",
        allowedOrigins: [ORIGIN, "https://cms.school.edu"],
      })
    ).json().token;

    const res = await app.inject({
      method: "GET",
      url: `/embed/widget?token=${encodeURIComponent(token)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain(
      `frame-ancestors 'self' ${ORIGIN} https://cms.school.edu`,
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("Intro to Biology");
  });

  it("rejects missing tenant, bad resource type, and invalid origins", async () => {
    const app = build();
    // No tenant header.
    expect(
      (
        await mint(
          app,
          { resourceType: "course", resourceId: "c1", allowedOrigins: [ORIGIN] },
          {},
        )
      ).statusCode,
    ).toBe(400);
    // Bad resource type.
    expect(
      (await mint(app, { resourceType: "nope", resourceId: "c1", allowedOrigins: [ORIGIN] }))
        .statusCode,
    ).toBe(400);
    // Empty / invalid origins.
    expect(
      (await mint(app, { resourceType: "course", resourceId: "c1", allowedOrigins: [] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await mint(app, { resourceType: "course", resourceId: "c1", allowedOrigins: ["*"] }))
        .statusCode,
    ).toBe(400);
    // ttl out of range.
    expect(
      (
        await mint(app, {
          resourceType: "course",
          resourceId: "c1",
          allowedOrigins: [ORIGIN],
          ttlSeconds: 999999,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("fails closed for missing, tampered, and expired tokens", async () => {
    const app = build();
    // Missing token.
    expect(
      (await app.inject({ method: "GET", url: "/embed/widget" })).statusCode,
    ).toBe(400);
    // Tampered token.
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/embed/widget?token=not.a.real.token",
        })
      ).statusCode,
    ).toBe(401);
    // Already-expired token (negative ttl).
    const expired = await signEmbedToken(
      {
        tenantId: TENANT_ID,
        resourceType: "course",
        resourceId: "c1",
        allowedOrigins: [ORIGIN],
      },
      { secret: JWT_SECRET, ttlSeconds: -10 },
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/embed/widget?token=${encodeURIComponent(expired)}`,
        })
      ).statusCode,
    ).toBe(401);
  });

  it("does not accept an API access token as an embed token (audience separation)", async () => {
    const app = build();
    const access = await signAccessToken(
      {
        sub: "u1",
        tenantId: TENANT_ID,
        parentTenantId: null,
        tier: "pool",
        roles: ["student"],
        scopes: [],
      },
      { secret: JWT_SECRET, audience: "lms-api" },
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/embed/widget?token=${encodeURIComponent(access)}`,
        })
      ).statusCode,
    ).toBe(401);
  });
});
