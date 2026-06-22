import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the BFF logout route (#103, AC5).
 *
 * Pure unit tests: `next/headers` `cookies()` and global `fetch` are mocked.
 *
 * Asserts:
 *  - calls identity POST /auth/logout with the refresh token (family revoke)
 *    and `x-tenant-id`, then clears BOTH cookies;
 *  - still succeeds (and clears cookies) when the identity fetch throws;
 *  - still succeeds (and skips upstream) when there is no refresh cookie.
 */

// mutable refresh value so each test controls what the jar returns
let refreshValue: string | undefined;
const jarDelete = vi.fn((_name: string) => {});
const jarSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "lms_rt" && refreshValue !== undefined
        ? { name, value: refreshValue }
        : undefined,
    set: (...args: unknown[]) => jarSet(...args),
    delete: (name: string) => jarDelete(name),
  }),
}));

import { POST } from "./route";

const IDENTITY_URL = "http://localhost:4001";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

describe("POST /api/auth/logout (BFF)", () => {
  beforeEach(() => {
    jarDelete.mockReset();
    jarSet.mockReset();
    refreshValue = undefined;
    vi.unstubAllGlobals();
  });

  it("AC5: revokes the refresh-token family upstream with x-tenant-id and clears BOTH cookies", async () => {
    refreshValue = "RT-to-revoke";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST();

    // upstream family-revoke call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/auth/logout`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe(
      TENANT_ID,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      refreshToken: "RT-to-revoke",
    });

    // both cookies cleared
    expect(jarDelete).toHaveBeenCalledWith("lms_at");
    expect(jarDelete).toHaveBeenCalledWith("lms_rt");
    expect(jarDelete).toHaveBeenCalledTimes(2);

    // success flag
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("AC5: still succeeds and clears cookies when the identity fetch THROWS", async () => {
    refreshValue = "RT-network-fail";
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jarDelete).toHaveBeenCalledWith("lms_at");
    expect(jarDelete).toHaveBeenCalledWith("lms_rt");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("AC5: succeeds with no upstream call when there is NO refresh cookie", async () => {
    refreshValue = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(jarDelete).toHaveBeenCalledWith("lms_at");
    expect(jarDelete).toHaveBeenCalledWith("lms_rt");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
