import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

/**
 * Unit tests for the Edge middleware (auth redirect #103/AC3 + custom-domain →
 * tenant resolution #12).
 *
 * Pure unit tests: middleware is a function of NextRequest, so we build a real
 * NextRequest (with/without the lms_at cookie, on first-party vs custom hosts)
 * and inspect the returned NextResponse. The tenant by-domain lookup is stubbed
 * via global fetch so no real network is hit.
 *
 * Asserts:
 *  - protected path + absent lms_at  => 307 redirect to /login?next=<path>;
 *  - protected path + present lms_at => pass-through (no redirect);
 *  - public paths (/login, /api/auth/*) => pass-through even without a cookie;
 *  - a first-party host skips the by-domain lookup (no fetch);
 *  - a custom host resolves to a tenant id forwarded on x-lms-tenant.
 */

// First-party host so the auth-redirect tests don't trigger the by-domain
// lookup; matches APP_DOMAIN's localhost default via the "localhost" branch.
const HOST = "localhost";

function req(path: string, cookie?: { name: string; value: string }, host = HOST): NextRequest {
  const r = new NextRequest(new URL(`http://${host}${path}`), {
    headers: { host },
  });
  if (cookie) r.cookies.set(cookie.name, cookie.value);
  return r;
}

beforeEach(() => {
  // Default: no custom-domain lookups should be attempted on first-party hosts.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("middleware (auth redirect)", () => {
  it("AC3: redirects an unauthenticated protected request to /login with ?next=, status 307", async () => {
    const res = await middleware(req("/dashboard"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    const url = new URL(location);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("AC3: preserves a nested protected path in ?next=", async () => {
    const res = await middleware(req("/courses/123/lesson/4"));

    expect(res.status).toBe(307);
    const url = new URL(res.headers.get("location")!);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/courses/123/lesson/4");
  });

  it("AC3: passes through a protected request when lms_at IS present (no redirect)", async () => {
    const res = await middleware(
      req("/dashboard", { name: "lms_at", value: "AT-123" }),
    );

    // NextResponse.next() => not a redirect; no Location header.
    expect(res.headers.get("location")).toBeNull();
    expect([200, undefined]).toContain(res.status);
  });

  it("AC3: always passes through /login even with no cookie", async () => {
    const res = await middleware(req("/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("AC3: always passes through /api/auth/* (login/logout must run unauthenticated)", async () => {
    for (const path of ["/api/auth/login", "/api/auth/logout", "/api/auth/sso/start"]) {
      const res = await middleware(req(path));
      expect(res.headers.get("location")).toBeNull();
    }
  });
});

describe("middleware (custom-domain → tenant resolution, #12)", () => {
  it("skips the by-domain lookup for a first-party (localhost) host", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await middleware(req("/login", undefined, "localhost"));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the resolved tenant id on x-lms-tenant for a custom host (pre-auth /login)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ tenantId: "tenant-xyz" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await middleware(req("/login", undefined, "learn.school.edu"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The resolved tenant is forwarded on the REQUEST headers (next() echoes
    // them via x-middleware-request-* on the response).
    expect(res.headers.get("x-middleware-request-x-lms-tenant")).toBe("tenant-xyz");
    // /login is still a pass-through (no auth redirect).
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not set x-lms-tenant when the custom host has no mapping (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    const res = await middleware(req("/login", undefined, "unknown.example.com"));

    expect(res.headers.get("x-middleware-request-x-lms-tenant")).toBeNull();
  });
});
