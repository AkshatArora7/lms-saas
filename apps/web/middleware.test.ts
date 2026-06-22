import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "./middleware";

/**
 * Unit tests for the Edge auth middleware (#103, AC3).
 *
 * Pure unit tests: middleware is a pure function of NextRequest, so we build a
 * real NextRequest (with/without the lms_at cookie) and inspect the returned
 * NextResponse. No Next runtime, no network.
 *
 * Asserts:
 *  - protected path + absent lms_at  => 307 redirect to /login?next=<path>;
 *  - protected path + present lms_at => pass-through (no redirect);
 *  - public paths (/login, /api/auth/*) => pass-through even without a cookie.
 */

function req(path: string, cookie?: { name: string; value: string }): NextRequest {
  const r = new NextRequest(new URL(`http://web.test${path}`));
  if (cookie) r.cookies.set(cookie.name, cookie.value);
  return r;
}

describe("middleware (auth redirect)", () => {
  it("AC3: redirects an unauthenticated protected request to /login with ?next=, status 307", () => {
    const res = middleware(req("/dashboard"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    const url = new URL(location);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("AC3: preserves a nested protected path in ?next=", () => {
    const res = middleware(req("/courses/123/lesson/4"));

    expect(res.status).toBe(307);
    const url = new URL(res.headers.get("location")!);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/courses/123/lesson/4");
  });

  it("AC3: passes through a protected request when lms_at IS present (no redirect)", () => {
    const res = middleware(
      req("/dashboard", { name: "lms_at", value: "AT-123" }),
    );

    // NextResponse.next() => not a redirect; no Location header.
    expect(res.headers.get("location")).toBeNull();
    expect([200, undefined]).toContain(res.status);
  });

  it("AC3: always passes through /login even with no cookie", () => {
    const res = middleware(req("/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("AC3: always passes through /api/auth/* (login/logout must run unauthenticated)", () => {
    for (const path of ["/api/auth/login", "/api/auth/logout", "/api/auth/sso/start"]) {
      const res = middleware(req(path));
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
