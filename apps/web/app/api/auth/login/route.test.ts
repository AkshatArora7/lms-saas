import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the BFF login route (#103, AC1 + AC2).
 *
 * Pure unit tests: `next/headers` `cookies()` and global `fetch` are mocked, so
 * there is no Next runtime, no network and no Postgres. `next/server`
 * `NextResponse` is the real Web-standard implementation shipped with Next, so
 * we can read back cookies / status from the response object.
 *
 * Asserts:
 *  - success (JSON transport) sets BOTH cookies (lms_at, lms_rt) with
 *    httpOnly + sameSite=lax + secure-in-prod, proxies identity POST /auth/login
 *    with `x-tenant-id`, and returns `{ ok: true }` with NO token in the body;
 *  - invalid_credentials → JSON error, NO cookies set;
 *  - the form transport sets cookies on the redirect response and 303-redirects.
 */

// ---- mock next/headers cookies() jar (used on the JSON success path) --------
interface SetCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}
const jarSet = vi.fn(
  (_name: string, _value: string, _options: Record<string, unknown>) => {},
);
const jarDelete = vi.fn((_name: string) => {});
vi.mock("next/headers", () => ({
  cookies: () => ({
    set: (name: string, value: string, options: Record<string, unknown>) =>
      jarSet(name, value, options),
    get: vi.fn(),
    delete: (name: string) => jarDelete(name),
  }),
}));

import { POST } from "./route";

const IDENTITY_URL = "http://localhost:4001";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function jsonReq(body: unknown): Request {
  return new Request("http://web.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formReq(fields: Record<string, string>): Request {
  const params = new URLSearchParams(fields);
  return new Request("http://web.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

function setCalls(): SetCall[] {
  return jarSet.mock.calls.map(([name, value, options]) => ({
    name,
    value,
    options,
  }));
}

describe("POST /api/auth/login (BFF)", () => {
  beforeEach(() => {
    jarSet.mockReset();
    jarDelete.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("AC1+AC2: success proxies identity with x-tenant-id and sets both httpOnly cookies, body is {ok} only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tokenType: "Bearer",
          accessToken: "AT-123",
          refreshToken: "RT-456",
          expiresIn: 900,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(jsonReq({ email: "learner@demo.test", password: "pw" }));

    // ---- AC1: proxied upstream identity POST /auth/login with x-tenant-id ----
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/auth/login`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe(TENANT_ID);
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "learner@demo.test",
      password: "pw",
    });

    // ---- AC2: both cookies set with the right security flags ----
    const calls = setCalls();
    expect(calls.map((c) => c.name).sort()).toEqual(["lms_at", "lms_rt"]);
    const at = calls.find((c) => c.name === "lms_at")!;
    const rt = calls.find((c) => c.name === "lms_rt")!;
    expect(at.value).toBe("AT-123");
    expect(rt.value).toBe("RT-456");
    for (const c of calls) {
      expect(c.options.httpOnly).toBe(true);
      expect(c.options.sameSite).toBe("lax");
      expect(c.options.path).toBe("/");
      // not in production -> secure is false here
      expect(c.options.secure).toBe(false);
    }
    expect(at.options.maxAge).toBe(900);
    expect(rt.options.maxAge).toBe(60 * 60 * 24 * 30);

    // ---- AC2: body never leaks a token ----
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true });
    expect(JSON.stringify(body)).not.toContain("AT-123");
    expect(JSON.stringify(body)).not.toContain("RT-456");
  });

  it("AC2: secure cookie flag is true in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    // Re-import route + lib so cookieBase recomputes with NODE_ENV=production.
    const prodJarSet = vi.fn();
    vi.doMock("next/headers", () => ({
      cookies: () => ({
        set: (n: string, v: string, o: Record<string, unknown>) =>
          prodJarSet(n, v, o),
        get: vi.fn(),
        delete: vi.fn(),
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresIn: 900 }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST: prodPOST } = await import("./route");

    await prodPOST(jsonReq({ email: "a@b.c", password: "pw" }));

    expect(prodJarSet).toHaveBeenCalledTimes(2);
    for (const call of prodJarSet.mock.calls) {
      const options = call[2] as Record<string, unknown>;
      expect(options.secure).toBe(true);
    }
    vi.doUnmock("next/headers");
    vi.resetModules();
  });

  it("AC1: invalid_credentials -> JSON error with upstream status and NO cookies set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_credentials" }), {
        status: 401,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(jsonReq({ email: "x@y.z", password: "bad" }));

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_credentials");
    expect(jarSet).not.toHaveBeenCalled();
  });

  it("AC1: malformed JSON body -> 400 invalid_request, no upstream call, no cookies", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const badReq = new Request("http://web.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await POST(badReq);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jarSet).not.toHaveBeenCalled();
  });

  it("AC1+AC2: form transport success sets cookies on the 303 redirect response (cookies on the response, not the jar)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ accessToken: "FAT", refreshToken: "FRT", expiresIn: 900 }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(formReq({ email: "f@g.h", password: "pw" }));

    // upstream still proxied with x-tenant-id
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe(
      TENANT_ID,
    );

    // 303 redirect to "/"
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://web.test/");

    // cookies are set on the *response*, not the cookies() jar
    expect(jarSet).not.toHaveBeenCalled();
    const at = res.cookies.get("lms_at");
    const rt = res.cookies.get("lms_rt");
    expect(at?.value).toBe("FAT");
    expect(rt?.value).toBe("FRT");
    expect(at?.httpOnly).toBe(true);
    expect(at?.sameSite).toBe("lax");
  });

  it("AC1: form transport invalid creds -> 303 redirect back to /login with error code only (no credentials)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_credentials" }), {
        status: 401,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(formReq({ email: "secret@user.test", password: "topsecret" }));

    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).toContain("error=invalid_credentials");
    // credentials must never appear in the redirect URL
    expect(location).not.toContain("secret@user.test");
    expect(location).not.toContain("topsecret");
    expect(jarSet).not.toHaveBeenCalled();
  });
});
