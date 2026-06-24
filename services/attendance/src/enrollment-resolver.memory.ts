import type { TenantContext } from "@lms/types";

import type {
  EnrollmentRosterResolver,
  RosterStudent,
} from "./enrollment-resolver.js";

/** A seeded (tenant, section) → active roster tuple. */
export interface SeededRoster {
  tenantId: string;
  orgUnitId: string;
  students: RosterStudent[];
}

/**
 * In-memory EnrollmentRosterResolver for tests — no live network. Seeded with
 * (tenant, section) → active-roster tuples, so it emulates enrollment's
 * already-filtered (active ∧ tenant-scoped) `getRoster` result. A section/tenant
 * with no seeded tuple resolves to an empty roster. Mirrors
 * guardian-resolver.memory.ts.
 */
export class FakeEnrollmentRosterResolver implements EnrollmentRosterResolver {
  private readonly seeds: SeededRoster[];

  constructor(seeds: SeededRoster[] = []) {
    this.seeds = seeds;
  }

  async resolveRoster(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<RosterStudent[]> {
    const match = this.seeds.find(
      (s) => s.tenantId === ctx.tenantId && s.orgUnitId === orgUnitId,
    );
    return match ? [...match.students] : [];
  }
}
