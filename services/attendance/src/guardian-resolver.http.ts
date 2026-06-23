import type {
  GuardianChild,
  GuardianChildrenResolver,
} from "./guardian-resolver.js";

export interface HttpGuardianResolverOptions {
  /** Base URL of the API gateway, e.g. http://gateway:4000. */
  gatewayUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Gateway-backed GuardianChildrenResolver (#190). Calls user-org's
 * consent-filtered authorized-children read
 * (`GET /guardians/:guardianId/children/authorized`, guardian.routes.ts) through
 * the gateway, forwarding `x-tenant-id` so user-org applies its own RLS and
 * consent gate. user-org returns ONLY active + consented children, so attendance
 * trusts the returned set and treats "not in the set" as deny. Any non-2xx or
 * unreachable upstream yields an empty set (fail closed — no child is exposed on
 * an upstream error), mirroring offboarding.http.ts.
 */
export function createHttpGuardianChildrenResolver(
  opts: HttpGuardianResolverOptions,
): GuardianChildrenResolver {
  const base = opts.gatewayUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async resolveChildren(ctx, guardianUserId): Promise<GuardianChild[]> {
      try {
        const res = await doFetch(
          `${base}/user-org/guardians/${guardianUserId}/children/authorized`,
          { headers: { "x-tenant-id": ctx.tenantId } },
        );
        if (!res.ok) return [];
        const body = (await res.json().catch(() => ({}))) as {
          children?: GuardianChild[];
        };
        return body.children ?? [];
      } catch {
        return [];
      }
    },
  };
}
