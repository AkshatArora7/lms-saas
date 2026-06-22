import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for resolveCurrentTenantId() precedence (#12).
 *
 * Pure unit tests: `next/headers` `headers()`/`cookies()` and global `fetch`
 * are mocked (mirrors auth.test.ts / locale route conventions) — no Next
 * runtime, no Postgres, no network. The authenticated session is driven through
 * the real getSession() path (access cookie + a 200 /auth/me) so we exercise the
 * actual precedence wiring, not a stub of it.
 *
 * Asserts the documented precedence:
 *  1. the edge-set `x-lms-tenant` header (custom-domain Host match) WINS;
 *  2. the authenticated session tenant wins when no header is present;
 *  3. the pinned default TENANT_ID is used when neither is present.
 */

let headerValue: string | undefined;
let accessValue: string | undefined;

vi.mock("next/headers", () => ({
  headers: () => ({
    get: (name: string) =>
      name === "x-lms-tenant" && headerValue !== undefined
        ? headerValue
        : null,
  }),
  cookies: () => ({
    get: (name: string) =>
      name === "lms_at" && accessValue !== undefined
        ? { name, value: accessValue }
        : undefined,
  }),
}));

import { resolveCurrentTenantId, TENANT_HEADER, TENANT_ID } from "./auth";

const SESSION_TENANT = "session-tenant-id";

/** A 200 /auth/me with the given tenant so getSession() yields a real session. */
function meWithTenant(tenantId: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ userId: "u-1", tenantId }), {
        status: 200,
      }),
    ),
  );
}

describe("resolveCurrentTenantId() precedence", () => {
  beforeEach(() => {
    headerValue = undefined;
    accessValue = undefined;
    vi.unstubAllGlobals();
  });

  it("uses the constant TENANT_HEADER name (x-lms-tenant)", () => {
    expect(TENANT_HEADER).toBe("x-lms-tenant");
  });

  it("the edge-set x-lms-tenant header WINS over the session tenant and the pinned default", async () => {
    headerValue = "header-tenant-id";
    accessValue = "AT-valid";
    meWithTenant(SESSION_TENANT);

    expect(await resolveCurrentTenantId()).toBe("header-tenant-id");
  });

  it("trims whitespace from the x-lms-tenant header value", async () => {
    headerValue = "  header-tenant-id  ";
    expect(await resolveCurrentTenantId()).toBe("header-tenant-id");
  });

  it("ignores a blank x-lms-tenant header and falls through to the session tenant", async () => {
    headerValue = "   ";
    accessValue = "AT-valid";
    meWithTenant(SESSION_TENANT);

    expect(await resolveCurrentTenantId()).toBe(SESSION_TENANT);
  });

  it("the session tenant wins over the pinned default when no header is present", async () => {
    headerValue = undefined;
    accessValue = "AT-valid";
    meWithTenant(SESSION_TENANT);

    expect(await resolveCurrentTenantId()).toBe(SESSION_TENANT);
  });

  it("uses the pinned default TENANT_ID when neither header nor session is present", async () => {
    headerValue = undefined;
    accessValue = undefined; // no cookie => getSession returns null, no fetch
    vi.stubGlobal("fetch", vi.fn());

    expect(await resolveCurrentTenantId()).toBe(TENANT_ID);
  });
});
