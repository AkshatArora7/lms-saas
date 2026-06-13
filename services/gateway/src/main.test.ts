import { signAccessToken } from "@lms/auth";
import type { AppConfig } from "@lms/config";
import { beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./main.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** Minimal config for the gateway under test (no real env needed). */
const config = {
  NODE_ENV: "test",
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  JWT_SECRET: "test-secret-at-least-16-chars",
  JWT_AUDIENCE: "lms-api",
  ACCESS_TOKEN_TTL: 900,
  REFRESH_TOKEN_TTL: 2_592_000,
} as unknown as AppConfig;

async function token(opts: {
  sub?: string;
  roles?: string[];
  scopes?: string[];
  ttlSeconds?: number;
}): Promise<string> {
  return signAccessToken(
    {
      sub: opts.sub ?? "user-1",
      tenantId: TENANT_ID,
      tier: "pool",
      roles: (opts.roles ?? ["learner"]) as never,
      scopes: opts.scopes ?? [],
    },
    {
      secret: config.JWT_SECRET,
      audience: config.JWT_AUDIENCE,
      ttlSeconds: opts.ttlSeconds ?? 900,
    },
  );
}

describe("gateway service", () => {
  beforeAll(() => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/lms_test";
    process.env.JWT_SECRET ??= "test-secret-at-least-16-chars";
  });

  it("GET /health is public and reports ok", async () => {
    const app = buildApp({ config });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("gateway");
    await app.close();
  });

  it("rejects /whoami without a bearer token", async () => {
    const app = buildApp({ config });
    const res = await app.inject({ method: "GET", url: "/whoami" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthorized");
    await app.close();
  });

  it("resolves the tenant and claims from a valid token", async () => {
    const app = buildApp({ config });
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: {
        authorization: `Bearer ${await token({ roles: ["org_admin"], scopes: ["users:manage"] })}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBe("user-1");
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.tier).toBe("pool");
    expect(body.roles).toContain("org_admin");
    await app.close();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const app = buildApp({ config });
    const forged = await signAccessToken(
      { sub: "x", tenantId: TENANT_ID, tier: "pool", roles: [], scopes: [] },
      { secret: "a-totally-different-secret", audience: config.JWT_AUDIENCE },
    );
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects an expired token", async () => {
    const app = buildApp({ config });
    const expired = await token({ ttlSeconds: -10 });
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("enforces scopes on a guarded route", async () => {
    const app = buildApp({ config });

    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/ping",
      headers: {
        authorization: `Bearer ${await token({ scopes: ["courses:read"] })}`,
      },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error).toBe("forbidden");

    const allowed = await app.inject({
      method: "GET",
      url: "/admin/ping",
      headers: {
        authorization: `Bearer ${await token({ scopes: ["users:manage"] })}`,
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().ok).toBe(true);
    await app.close();
  });

  it("lets super_admin bypass scope checks", async () => {
    const app = buildApp({ config });
    const res = await app.inject({
      method: "GET",
      url: "/admin/ping",
      headers: {
        authorization: `Bearer ${await token({ roles: ["super_admin"], scopes: [] })}`,
      },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("gateway reverse proxy", () => {
  beforeAll(() => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/lms_test";
    process.env.JWT_SECRET ??= "test-secret-at-least-16-chars";
  });

  interface Captured {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }

  function fakeFetch(capture: Captured[]): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      capture.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body as string | undefined,
      });
      return new Response(JSON.stringify({ proxied: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }

  function buildProxyApp(capture: Captured[]) {
    return buildApp({
      config,
      proxy: {
        resolveUpstream: (s) =>
          s === "course" ? "http://course-svc:4007" : null,
        fetchImpl: fakeFetch(capture),
      },
    });
  }

  it("forwards an authenticated request and injects the resolved tenant", async () => {
    const capture: Captured[] = [];
    const app = buildProxyApp(capture);

    const res = await app.inject({
      method: "GET",
      url: "/api/course/courses?limit=10",
      headers: { authorization: `Bearer ${await token({})}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().proxied).toBe(true);
    expect(capture).toHaveLength(1);
    expect(capture[0].url).toBe("http://course-svc:4007/courses?limit=10");
    expect(capture[0].headers["x-tenant-id"]).toBe(TENANT_ID);
    await app.close();
  });

  it("never forwards the client Authorization header upstream", async () => {
    const capture: Captured[] = [];
    const app = buildProxyApp(capture);
    await app.inject({
      method: "GET",
      url: "/api/course/x",
      headers: { authorization: `Bearer ${await token({})}` },
    });
    const fwd = capture[0].headers;
    const keys = Object.keys(fwd).map((k) => k.toLowerCase());
    expect(keys).not.toContain("authorization");
    await app.close();
  });

  it("overwrites a spoofed client x-tenant-id with the token's tenant", async () => {
    const capture: Captured[] = [];
    const app = buildProxyApp(capture);
    await app.inject({
      method: "GET",
      url: "/api/course/x",
      headers: {
        authorization: `Bearer ${await token({})}`,
        "x-tenant-id": "99999999-9999-9999-9999-999999999999",
      },
    });
    expect(capture[0].headers["x-tenant-id"]).toBe(TENANT_ID);
    await app.close();
  });

  it("forwards a JSON body on POST", async () => {
    const capture: Captured[] = [];
    const app = buildProxyApp(capture);
    await app.inject({
      method: "POST",
      url: "/api/course/courses",
      headers: { authorization: `Bearer ${await token({})}` },
      payload: { title: "Algebra" },
    });
    expect(capture[0].method).toBe("POST");
    expect(JSON.parse(capture[0].body ?? "{}")).toEqual({ title: "Algebra" });
    await app.close();
  });

  it("rejects an unauthenticated proxy request", async () => {
    const capture: Captured[] = [];
    const app = buildProxyApp(capture);
    const res = await app.inject({ method: "GET", url: "/api/course/x" });
    expect(res.statusCode).toBe(401);
    expect(capture).toHaveLength(0);
    await app.close();
  });

  it("404s an unknown upstream service", async () => {
    const capture: Captured[] = [];
    const app = buildProxyApp(capture);
    const res = await app.inject({
      method: "GET",
      url: "/api/nope/x",
      headers: { authorization: `Bearer ${await token({})}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("unknown_service");
    await app.close();
  });
});
