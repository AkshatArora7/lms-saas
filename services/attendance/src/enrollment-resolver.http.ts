import type {
  EnrollmentRosterResolver,
  RosterStudent,
} from "./enrollment-resolver.js";

export interface HttpEnrollmentResolverOptions {
  /** Base URL of the API gateway, e.g. http://gateway:4000. */
  gatewayUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Gateway-backed EnrollmentRosterResolver (#376). Calls enrollment's section
 * roster read (`GET /sections/:id/roster`, enrollment routes.ts) through the
 * gateway, forwarding `x-tenant-id` so enrollment applies its own RLS. The
 * endpoint returns ONLY active members, so attendance trusts the returned set
 * and seeds one record per entry. Any non-2xx or unreachable upstream yields an
 * empty roster (fail closed — the session is created with no seeded records on
 * an upstream error rather than failing), mirroring guardian-resolver.http.ts.
 */
export function createHttpEnrollmentRosterResolver(
  opts: HttpEnrollmentResolverOptions,
): EnrollmentRosterResolver {
  const base = opts.gatewayUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async resolveRoster(ctx, orgUnitId): Promise<RosterStudent[]> {
      try {
        const res = await doFetch(
          `${base}/enrollment/sections/${orgUnitId}/roster`,
          { headers: { "x-tenant-id": ctx.tenantId } },
        );
        if (!res.ok) return [];
        const body = (await res.json().catch(() => ({}))) as {
          roster?: { userId?: unknown }[];
        };
        if (!Array.isArray(body.roster)) return [];
        return body.roster
          .filter(
            (e): e is { userId: string } =>
              typeof e?.userId === "string" && e.userId.length > 0,
          )
          .map((e) => ({ userId: e.userId }));
      } catch {
        return [];
      }
    },
  };
}
