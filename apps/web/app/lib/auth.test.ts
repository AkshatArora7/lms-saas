import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for getSession() (#103, AC4).
 *
 * Pure unit tests: `next/headers` `cookies()` and global `fetch` are mocked.
 *
 * Asserts:
 *  - null when no access cookie is present (no upstream call);
 *  - null on a non-OK /auth/me;
 *  - the parsed Session on 200;
 *  - null when fetch throws;
 *  - the request carries a Bearer authorization header.
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

import { getSession } from "./auth";

const IDENTITY_URL = "http://localhost:4001";

const ME = {
  userId: "u-1",
  tenantId: "11111111-1111-1111-1111-111111111111",
  tier: "pro",
  roles: ["learner"],
  scopes: ["course:read"],
  locale: "es",
};

describe("getSession()", () => {
  beforeEach(() => {
    accessValue = undefined;
    vi.unstubAllGlobals();
  });

  it("AC4: returns null and does NOT call identity when there is no access cookie", async () => {
    accessValue = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AC4: returns the parsed Session on a 200 /auth/me and sends a Bearer header", async () => {
    accessValue = "AT-valid";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(ME), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const session = await getSession();

    expect(session).toEqual(ME);
    // #88: locale from /auth/me flows into the Session.
    expect(session?.locale).toBe("es");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/auth/me`);
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer AT-valid",
    );
  });

  it("#88: defaults locale to 'en' when /auth/me omits it (older identity)", async () => {
    accessValue = "AT-valid";
    const { locale: _drop, ...withoutLocale } = ME;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(withoutLocale), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const session = await getSession();
    expect(session?.locale).toBe("en");
  });

  it("AC4: returns null on a non-OK /auth/me (e.g. expired token => 401)", async () => {
    accessValue = "AT-expired";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getSession()).toBeNull();
  });

  it("AC4: returns null when the fetch throws (identity unreachable)", async () => {
    accessValue = "AT-valid";
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getSession()).toBeNull();
  });
});
