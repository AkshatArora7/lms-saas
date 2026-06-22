import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the admin auth helpers (#104).
 *  - getSession: AC-supporting — null when no cookie, null on non-OK /auth/me,
 *    a Session on 200, and the Bearer header carries the access cookie.
 *  - isAdmin: AC2 — only the privileged role set (super_admin / org_admin) gates
 *    into the console; learner-only and empty roles are rejected.
 *
 * Pure unit: `next/headers` cookies() and global fetch are mocked — no Next
 * runtime, no network.
 */

// --- mock next/headers cookies() jar -------------------------------------
const jarGet = vi.fn((_name: string) => undefined as { value: string } | undefined);
vi.mock("next/headers", () => ({
  cookies: () => ({ get: jarGet }),
}));

import {
  getSession,
  isAdmin,
  ACCESS_COOKIE,
  IDENTITY_URL,
  type Session,
} from "./auth";

const fetchMock = vi.fn();

function makeSession(roles: string[]): Session {
  return {
    userId: "u1",
    tenantId: "t1",
    tier: "pro",
    roles,
    scopes: [],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("getSession", () => {
  it("returns null when there is no access cookie (and never calls identity)", async () => {
    jarGet.mockImplementation(() => undefined);
    const session = await getSession();
    expect(session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the Session and sends a Bearer access token to /auth/me on 200", async () => {
    jarGet.mockImplementation((name: string) =>
      name === ACCESS_COOKIE ? { value: "acc-token" } : undefined,
    );
    const payload = makeSession(["org_admin"]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as unknown as Response);

    const session = await getSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IDENTITY_URL}/auth/me`);
    const headers = opts.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer acc-token");
    expect(session).toEqual(payload);
  });

  it("returns null when /auth/me responds non-OK", async () => {
    jarGet.mockImplementation((name: string) =>
      name === ACCESS_COOKIE ? { value: "stale-token" } : undefined,
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as unknown as Response);

    expect(await getSession()).toBeNull();
  });

  it("returns null (does not throw) when the identity call rejects", async () => {
    jarGet.mockImplementation((name: string) =>
      name === ACCESS_COOKIE ? { value: "tok" } : undefined,
    );
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    expect(await getSession()).toBeNull();
  });
});

describe("isAdmin (AC2 role gating)", () => {
  it("super_admin -> true", () => {
    expect(isAdmin(makeSession(["super_admin"]))).toBe(true);
  });

  it("org_admin -> true", () => {
    expect(isAdmin(makeSession(["org_admin"]))).toBe(true);
  });

  it("learner-only -> false", () => {
    expect(isAdmin(makeSession(["learner"]))).toBe(false);
  });

  it("empty roles -> false", () => {
    expect(isAdmin(makeSession([]))).toBe(false);
  });

  it("mixed roles including one admin role -> true", () => {
    expect(isAdmin(makeSession(["learner", "teacher", "org_admin"]))).toBe(
      true,
    );
  });

  it("mixed non-admin roles -> false", () => {
    expect(isAdmin(makeSession(["learner", "teacher", "parent"]))).toBe(false);
  });
});
