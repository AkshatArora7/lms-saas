import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the admin BFF login route (#104 AC1 — "same secure BFF cookie
 * pattern as the learner app"). Pure unit: `next/headers` cookies() and global
 * fetch are mocked, so there is no Next runtime, no network, and no Postgres.
 *
 * `next/server`'s real NextResponse is used (it works in plain Node) so the
 * cookie flags and redirect status we assert are the genuine ones the route
 * emits, not a stub's.
 */

// --- mock next/headers cookies() jar -------------------------------------
const jarSet = vi.fn((_name: string, _value: string, _opts?: unknown) => {});
const cookiesMock = vi.fn(() => ({ set: jarSet }));
vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

import { POST } from "./route";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  IDENTITY_URL,
  TENANT_ID,
} from "../../../lib/auth";

const fetchMock = vi.fn();

/** Build a fake upstream identity Response. */
function upstreamResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("admin login route — JSON transport", () => {
  it("on success sets BOTH cookies with httpOnly+sameSite, proxies identity with x-tenant-id, no token in JSON body", async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse({
        accessToken: "acc-123",
        refreshToken: "ref-456",
        expiresIn: 1200,
      }),
    );

    const req = new Request("http://admin.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@acme.test", password: "pw" }),
    });

    const res = await POST(req);

    // Proxied to identity /auth/login with the tenant header, credentials in body.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/auth/login`);
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe(TENANT_ID);
    expect(headers["content-type"]).toBe("application/json");
    expect(opts.body).toBe(
      JSON.stringify({ email: "admin@acme.test", password: "pw" }),
    );

    // Both cookies set on the next/headers jar.
    expect(jarSet).toHaveBeenCalledTimes(2);
    const access = jarSet.mock.calls.find((c) => c[0] === ACCESS_COOKIE);
    const refresh = jarSet.mock.calls.find((c) => c[0] === REFRESH_COOKIE);
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    expect(access?.[1]).toBe("acc-123");
    expect(refresh?.[1]).toBe("ref-456");

    // Cookie security flags (secure follows NODE_ENV; not prod here so false).
    const accessOpts = access?.[2] as Record<string, unknown>;
    const refreshOpts = refresh?.[2] as Record<string, unknown>;
    expect(accessOpts.httpOnly).toBe(true);
    expect(accessOpts.sameSite).toBe("lax");
    expect(accessOpts.path).toBe("/");
    expect(accessOpts.maxAge).toBe(1200);
    expect(refreshOpts.httpOnly).toBe(true);
    expect(refreshOpts.sameSite).toBe("lax");
    expect(refreshOpts.maxAge).toBe(60 * 60 * 24 * 30);

    // Response body carries only the {ok} flag — never the tokens.
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual({ ok: true });
    expect(JSON.stringify(json)).not.toContain("acc-123");
    expect(JSON.stringify(json)).not.toContain("ref-456");
  });

  it("falls back to maxAge 900 when identity omits expiresIn", async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse({ accessToken: "a", refreshToken: "r" }),
    );
    const req = new Request("http://admin.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x", password: "y" }),
    });
    await POST(req);
    const access = jarSet.mock.calls.find((c) => c[0] === ACCESS_COOKIE);
    expect((access?.[2] as Record<string, unknown>).maxAge).toBe(900);
  });

  it("on invalid_credentials returns error code only and sets NO cookies", async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse(
        { error: "invalid_credentials", message: "bad creds" },
        { ok: false, status: 401 },
      ),
    );

    const req = new Request("http://admin.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@acme.test", password: "wrong" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("invalid_credentials");
    // No session ever established on failure.
    expect(jarSet).not.toHaveBeenCalled();
  });

  it("maps an ok-but-tokenless upstream to 502 and sets NO cookies", async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse({}, { ok: true, status: 200 }),
    );
    const req = new Request("http://admin.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x", password: "y" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
    expect(jarSet).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request on malformed JSON without calling identity", async () => {
    const req = new Request("http://admin.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jarSet).not.toHaveBeenCalled();
  });
});

describe("admin login route — form transport", () => {
  function formReq(email: string, password: string): Request {
    const body = new URLSearchParams({ email, password });
    return new Request("http://admin.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  it("on success issues a 303 redirect to / with BOTH cookies on the response", async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse({
        accessToken: "facc",
        refreshToken: "fref",
        expiresIn: 900,
      }),
    );

    const res = await POST(formReq("admin@acme.test", "pw"));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://admin.local/");

    // Form transport sets cookies on the response, not the next/headers jar.
    expect(jarSet).not.toHaveBeenCalled();
    const access = res.cookies.get(ACCESS_COOKIE);
    const refresh = res.cookies.get(REFRESH_COOKIE);
    expect(access?.value).toBe("facc");
    expect(refresh?.value).toBe("fref");
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe("lax");
    expect(refresh?.httpOnly).toBe(true);

    // Tenant header still stamped on the upstream proxy call.
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe(TENANT_ID);
  });

  it("on failure redirects to /login?error=<code> with NO cookies and never leaks credentials", async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse(
        { error: "invalid_credentials" },
        { ok: false, status: 401 },
      ),
    );

    const res = await POST(formReq("admin@acme.test", "secret-pw"));

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("error=invalid_credentials");
    // The submitted email/password must never appear in the redirect URL.
    expect(location).not.toContain("admin@acme.test");
    expect(location).not.toContain("secret-pw");

    expect(res.cookies.get(ACCESS_COOKIE)).toBeUndefined();
    expect(res.cookies.get(REFRESH_COOKIE)).toBeUndefined();
  });
});
