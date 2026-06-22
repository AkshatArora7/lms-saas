import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the learner BFF locale route (#88). Pure unit: `next/headers`
 * cookies() (for the access token) and global fetch are mocked; the real
 * NextResponse is used so the emitted `lms_locale` cookie + status are genuine.
 */

let accessValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "lms_at" && accessValue !== undefined
        ? { name, value: accessValue }
        : undefined,
  }),
}));

import { POST } from "./route";
import { IDENTITY_URL, TENANT_ID } from "../../lib/auth";

const fetchMock = vi.fn();

function req(body: unknown): Request {
  return new Request("http://web.local/api/locale", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  accessValue = undefined;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("locale route — validation", () => {
  it("rejects an unsupported locale with 400, no identity call", async () => {
    accessValue = "tok";
    const res = await POST(req({ locale: "fr" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_locale");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string locale with 400", async () => {
    const res = await POST(req({ locale: 42 }));
    expect(res.status).toBe(400);
  });
});

describe("locale route — authenticated", () => {
  it("forwards to identity PATCH /users/me/locale with bearer + x-tenant-id, never leaking the token", async () => {
    accessValue = "acc-123";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    const res = await POST(req({ locale: "es" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/users/me/locale`);
    expect(opts.method).toBe("PATCH");
    const headers = opts.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer acc-123");
    expect(headers["x-tenant-id"]).toBe(TENANT_ID);
    expect(opts.body).toBe(JSON.stringify({ locale: "es" }));

    // Body forwarded carries no user id (IDOR-safe — id derived from token).
    expect(opts.body as string).not.toContain("userId");

    // Response carries only {ok}, never the token, and sets the cookie mirror.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("lms_locale=es");
    expect(setCookie).not.toContain("acc-123");
  });

  it("returns 502 when identity rejects the persist", async () => {
    accessValue = "acc-123";
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    const res = await POST(req({ locale: "es" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("persist_failed");
  });
});

describe("locale route — unauthenticated", () => {
  it("sets the cookie WITHOUT calling identity when there is no access token", async () => {
    accessValue = undefined;
    const res = await POST(req({ locale: "es" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("lms_locale=es");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).toContain("path=/");
  });
});
