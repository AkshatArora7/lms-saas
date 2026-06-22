import type { TenantContext } from "@lms/types";
import { describe, expect, it } from "vitest";

import { createHttpStudentGuardiansResolver } from "./guardians.http.js";

const GATEWAY = "http://gateway:4000";

const TENANT: TenantContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const STUDENT_ID = "student-1";

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

describe("createHttpStudentGuardiansResolver — fail-closed boundary (#101)", () => {
  it("returns [] on a non-2xx (500) response and does not throw", async () => {
    const resolver = createHttpStudentGuardiansResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () => jsonResponse(false, { error: "boom" }, 500)),
    });

    await expect(
      resolver.resolveGuardians(TENANT, STUDENT_ID),
    ).resolves.toEqual([]);
  });

  it("returns [] when fetch throws (network error) and does not throw", async () => {
    const resolver = createHttpStudentGuardiansResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () => {
        throw new Error("ECONNREFUSED");
      }),
    });

    await expect(
      resolver.resolveGuardians(TENANT, STUDENT_ID),
    ).resolves.toEqual([]);
  });

  it("returns [] on a 2xx with a non-array guardians field ({ guardians: 'x' })", async () => {
    const resolver = createHttpStudentGuardiansResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () =>
        jsonResponse(true, { guardians: "x" }),
      ),
    });

    await expect(
      resolver.resolveGuardians(TENANT, STUDENT_ID),
    ).resolves.toEqual([]);
  });

  it("returns [] on a 2xx with a malformed body missing guardians ({})", async () => {
    const resolver = createHttpStudentGuardiansResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () => jsonResponse(true, {})),
    });

    await expect(
      resolver.resolveGuardians(TENANT, STUDENT_ID),
    ).resolves.toEqual([]);
  });

  it("drops entries with non-string/empty guardianUserId on a 2xx body", async () => {
    const resolver = createHttpStudentGuardiansResolver({
      gatewayUrl: GATEWAY,
      fetchImpl: stubFetch(async () =>
        jsonResponse(true, {
          guardians: [
            { guardianUserId: "g-keep" },
            { guardianUserId: "" },
            { guardianUserId: 42 },
            {},
          ],
        }),
      ),
    });

    await expect(
      resolver.resolveGuardians(TENANT, STUDENT_ID),
    ).resolves.toEqual([{ guardianUserId: "g-keep" }]);
  });

  it("maps a well-formed body, forwarding x-tenant-id to the authorized path", async () => {
    let seenUrl = "";
    let seenTenant: string | undefined;
    const resolver = createHttpStudentGuardiansResolver({
      gatewayUrl: `${GATEWAY}/`, // trailing slash should be normalized away
      fetchImpl: stubFetch(async (url, init) => {
        seenUrl = url;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seenTenant = headers["x-tenant-id"];
        return jsonResponse(true, {
          guardians: [
            { guardianUserId: "g-1" },
            { guardianUserId: "g-2" },
          ],
        });
      }),
    });

    const result = await resolver.resolveGuardians(TENANT, STUDENT_ID);

    expect(result).toEqual([
      { guardianUserId: "g-1" },
      { guardianUserId: "g-2" },
    ]);
    expect(seenUrl).toBe(
      `${GATEWAY}/user-org/students/${STUDENT_ID}/guardians/authorized`,
    );
    expect(seenTenant).toBe(TENANT.tenantId);
  });
});
