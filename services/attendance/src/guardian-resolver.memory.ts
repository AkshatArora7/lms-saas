import type { TenantContext } from "@lms/types";

import type {
  GuardianChild,
  GuardianChildrenResolver,
} from "./guardian-resolver.js";

/** A seeded (tenant, guardian) → authorized children tuple. */
export interface SeededGuardianChildren {
  tenantId: string;
  guardianUserId: string;
  children: GuardianChild[];
}

/**
 * In-memory GuardianChildrenResolver for tests — no live network. Seeded with
 * (tenant, guardian) → authorized children tuples, so it emulates user-org's
 * already-filtered (active ∧ consented ∧ tenant-scoped) result. Pending /
 * revoked / non-consented children are modelled simply by NOT seeding them; a
 * guardian/tenant with no seeded tuple resolves to an empty set.
 */
export class FakeGuardianChildrenResolver implements GuardianChildrenResolver {
  private readonly seeds: SeededGuardianChildren[];

  constructor(seeds: SeededGuardianChildren[] = []) {
    this.seeds = seeds;
  }

  async resolveChildren(
    ctx: TenantContext,
    guardianUserId: string,
  ): Promise<GuardianChild[]> {
    const match = this.seeds.find(
      (s) =>
        s.tenantId === ctx.tenantId && s.guardianUserId === guardianUserId,
    );
    return match ? [...match.children] : [];
  }
}
