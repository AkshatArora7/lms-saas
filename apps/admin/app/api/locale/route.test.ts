import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the admin BFF locale route (#88). Pure unit: `next/headers`
 * cookies() (admin access token) and global fetch are mocked; the real
 * NextResponse is used so the `lms_locale` cookie + status are genuine.
 */

let accessValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "lms_admin_at" && accessValue !== undefined
        ? { name, value: accessValue }
        : undefined,
  }),
}));

import { POST } from "./route";
import { IDENTITY_URL, TENANT_ID } from "../../lib/auth";

const fetchMock = vi.fn();

function req(body: unknown): Request {
  return new Request("http://admin.local/api/locale", {
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

describe("admin locale route", () => {
  it("rejects an unsupported locale with 400 and no identity call", async () => {
    accessValue = "tok";
    const res = await POST(req({ locale: "fr" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authenticated: forwards to identity with bearer + x-tenant-id, no token leak", async () => {
    accessValue = "admin-acc";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    const res = await POST(req({ locale: "es" }));

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/users/me/locale`);
    expect(opts.method).toBe("PATCH");
    const headers = opts.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer admin-acc");
    expect(headers["x-tenant-id"]).toBe(TENANT_ID);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("lms_locale=es");
    expect(setCookie).not.toContain("admin-acc");
  });

  it("unauthenticated: sets the cookie without calling identity", async () => {
    accessValue = undefined;
    const res = await POST(req({ locale: "en" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect((res.headers.get("set-cookie") ?? "")).toContain("lms_locale=en");
  });
});
