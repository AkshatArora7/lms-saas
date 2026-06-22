import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the admin BFF logout route (#104 AC4 — "sign out clears the
 * session and returns to /login"). The route revokes the refresh-token *family*
 * upstream (best-effort) and clears both cookies. Pure unit: `next/headers`
 * cookies() and global fetch are mocked — no Next runtime, no network.
 */

// --- mock next/headers cookies() jar -------------------------------------
const jarGet = vi.fn((_name: string) => undefined as { value: string } | undefined);
const jarDelete = vi.fn((_name: string) => {});
vi.mock("next/headers", () => ({
  cookies: () => ({ get: jarGet, delete: jarDelete }),
}));

import { POST } from "./route";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  IDENTITY_URL,
  TENANT_ID,
} from "../../../lib/auth";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("admin logout route", () => {
  it("revokes the refresh-token family upstream and clears BOTH cookies", async () => {
    jarGet.mockImplementation((name: string) =>
      name === REFRESH_COOKIE ? { value: "ref-token-xyz" } : undefined,
    );
    fetchMock.mockResolvedValueOnce({ ok: true } as unknown as Response);

    const res = await POST();

    // Upstream family-revoke call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/auth/logout`);
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe(TENANT_ID);
    expect(opts.body).toBe(JSON.stringify({ refreshToken: "ref-token-xyz" }));

    // Both cookies cleared.
    expect(jarDelete).toHaveBeenCalledWith(ACCESS_COOKIE);
    expect(jarDelete).toHaveBeenCalledWith(REFRESH_COOKIE);

    // Returns the {ok} flag the client uses before router.push("/login").
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("still clears both cookies and returns {ok} when there is no refresh cookie (no upstream call)", async () => {
    jarGet.mockImplementation(() => undefined);

    const res = await POST();

    // No refresh token => no revoke attempt.
    expect(fetchMock).not.toHaveBeenCalled();
    // Local session is cleared regardless.
    expect(jarDelete).toHaveBeenCalledWith(ACCESS_COOKIE);
    expect(jarDelete).toHaveBeenCalledWith(REFRESH_COOKIE);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("is resilient when the identity revoke call throws — local cookies still cleared", async () => {
    jarGet.mockImplementation((name: string) =>
      name === REFRESH_COOKIE ? { value: "ref-token-xyz" } : undefined,
    );
    fetchMock.mockRejectedValueOnce(new Error("identity unreachable"));

    const res = await POST();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The thrown upstream error is swallowed; logout still succeeds locally.
    expect(jarDelete).toHaveBeenCalledWith(ACCESS_COOKIE);
    expect(jarDelete).toHaveBeenCalledWith(REFRESH_COOKIE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
