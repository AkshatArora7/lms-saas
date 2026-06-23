import type { StudentGuardiansResolver } from "./guardians.js";

export interface HttpStudentGuardiansOptions {
  /** Base URL of the API gateway, e.g. http://gateway:4000. */
  gatewayUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface AuthorizedGuardiansResponse {
  guardians?: { guardianUserId?: unknown }[];
}

/**
 * Gateway-backed {@link StudentGuardiansResolver}, mirroring the tenant
 * service's offboarding HTTP ports. Calls
 * `GET {gateway}/user-org/students/:studentId/guardians/authorized`, forwarding
 * `x-tenant-id` so user-org applies its own RLS and consent gate.
 *
 * FAIL-CLOSED: any non-2xx response, network error, or parse error yields `[]`
 * so the attendance fan-out degrades to learner-only — never a broader or
 * cross-family fan-out.
 */
export function createHttpStudentGuardiansResolver(
  opts: HttpStudentGuardiansOptions,
): StudentGuardiansResolver {
  const base = opts.gatewayUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async resolveGuardians(ctx, studentUserId) {
      try {
        const res = await doFetch(
          `${base}/user-org/students/${encodeURIComponent(
            studentUserId,
          )}/guardians/authorized`,
          { headers: { "x-tenant-id": ctx.tenantId } },
        );
        if (!res.ok) return [];
        const body = (await res.json()) as AuthorizedGuardiansResponse;
        const guardians = Array.isArray(body.guardians) ? body.guardians : [];
        return guardians
          .map((g) => g.guardianUserId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .map((guardianUserId) => ({ guardianUserId }));
      } catch {
        return [];
      }
    },
  };
}
