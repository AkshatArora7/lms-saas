import type { TenantContext } from "@lms/types";
import { describe, expect, it } from "vitest";

import { createHttpEnrollmentRosterResolver } from "./enrollment-resolver.http.js";

const GATEWAY = "http://gateway:4000";

const TENANT: TenantContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const SECTION_ID = "section-1";

/** Build a fetch stub returning a canned Response-like object. */
function stubFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return impl as unknown as typeof fetch;
}

/** Minimal Response-like for tests, only the fields the resolver reads. */
function jsonResponse(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  } as unknown as Response;
}

describe("createHttpEnrollmentRosterResolver — fail-closed boundary (#376)", () => {
  it("returns [] on a non-2xx (500) response and does not throw", async () => {
    const resolver = createHttpEnrollmentRosterResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () =>
        jsonResponse(false, { error: "boom" }, 500),
      ),
    });

    await expect(
      resolver.resolveRoster(TENANT, SECTION_ID),
    ).resolves.toEqual([]);
  });

  it("returns [] when fetch throws (network error) and does not throw", async () => {
    const resolver = createHttpEnrollmentRosterResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () => {
        throw new Error("ECONNREFUSED");
      }),
    });

    await expect(
      resolver.resolveRoster(TENANT, SECTION_ID),
    ).resolves.toEqual([]);
  });

  it("returns [] on a 2xx with a non-array roster field ({ roster: 'x' })", async () => {
    const resolver = createHttpEnrollmentRosterResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () => jsonResponse(true, { roster: "x" })),
    });

    await expect(
      resolver.resolveRoster(TENANT, SECTION_ID),
    ).resolves.toEqual([]);
  });

  it("returns [] on a 2xx with a malformed body missing roster ({})", async () => {
    const resolver = createHttpEnrollmentRosterResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () => jsonResponse(true, {})),
    });

    await expect(
      resolver.resolveRoster(TENANT, SECTION_ID),
    ).resolves.toEqual([]);
  });

  it("drops entries with non-string/empty userId on a 2xx body", async () => {
    const resolver = createHttpEnrollmentRosterResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () =>
        jsonResponse(true, {
          roster: [
            { userId: "u-keep" },
            { userId: "" },
            { userId: 42 },
            {},
          ],
        }),
      ),
    });

    await expect(
      resolver.resolveRoster(TENANT, SECTION_ID),
    ).resolves.toEqual([{ userId: "u-keep" }]);
  });

  it("maps a well-formed body, forwarding x-tenant-id to the roster path", async () => {
    let seenUrl = "";
    let seenTenant: string | undefined;
    const resolver = createHttpEnrollmentRosterResolver({
      gatewayUrl: `${GATEWAY}/`, // trailing slash should be normalized away
      fetchImpl: stubFetch(async (url, init) => {
        seenUrl = url;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seenTenant = headers["x-tenant-id"];
        return jsonResponse(true, {
          roster: [{ userId: "u-1" }, { userId: "u-2" }],
        });
      }),
    });

    const result = await resolver.resolveRoster(TENANT, SECTION_ID);

    expect(result).toEqual([{ userId: "u-1" }, { userId: "u-2" }]);
    expect(seenUrl).toBe(
      `${GATEWAY}/enrollment/sections/${SECTION_ID}/roster`,
    );
    expect(seenTenant).toBe(TENANT.tenantId);
  });
});
