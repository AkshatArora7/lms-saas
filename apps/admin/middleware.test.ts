import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import { middleware } from "./middleware";

/**
 * Unit tests for the admin Edge middleware (#104 AC4 — centralized
 * unauthenticated -> /login redirect; auth-presence only, not role authz).
 *
 * The real NextResponse (from next/server) is used so the redirect status and
 * Location header we assert are the genuine ones. We hand-roll a minimal
 * NextRequest-shaped object because the real NextRequest needs the Edge
 * runtime; the middleware only touches `nextUrl.pathname`, `url`, and
 * `cookies.get(name)`, so this fake is faithful.
 */

const BASE = "http://admin.local";
const ACCESS_COOKIE = "lms_admin_at";

function makeRequest(
  pathname: string,
  opts: { hasCookie?: boolean } = {},
): NextRequest {
  const url = `${BASE}${pathname}`;
  return {
    nextUrl: new URL(url),
    url,
    cookies: {
      get: (name: string) =>
        opts.hasCookie && name === ACCESS_COOKIE
          ? { name, value: "some-access-token" }
          : undefined,
    },
  } as unknown as NextRequest;
}

describe("admin middleware — unauthenticated", () => {
  it("redirects to /login with 307 when the access cookie is absent on a protected path", () => {
    const res = middleware(makeRequest("/courses"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });

  it("preserves the intended destination via ?next= on the redirect", () => {
    const res = middleware(makeRequest("/courses/123/settings"));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/courses/123/settings");
  });

  it("redirects the protected root path when unauthenticated", () => {
    const res = middleware(makeRequest("/"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/");
  });
});

describe("admin middleware — authenticated pass-through", () => {
  it("passes through (NextResponse.next, no redirect) when the access cookie is present", () => {
    const res = middleware(makeRequest("/courses", { hasCookie: true }));
    // NextResponse.next() is a 200-class non-redirect response with no Location.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("admin middleware — public paths are never redirected", () => {
  it("lets /login through even with no cookie", () => {
    const res = middleware(makeRequest("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets /api/auth/* (login/logout/sso) through even with no cookie", () => {
    for (const path of [
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/sso/start",
      "/api/auth/sso/callback",
    ]) {
      const res = middleware(makeRequest(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
