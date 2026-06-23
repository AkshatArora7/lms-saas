import type { TenantContext } from "@lms/types";

/**
 * Guardian-scoped attendance authorization port (#190).
 *
 * Attendance owns `attendance_record` (RLS, tenant-scoped) and stays the single
 * reader of its own data; the guardian->child relationship + consent gate are
 * authoritative in user-org. So attendance depends on that authority through an
 * injected port: prod = HTTP to user-org's consent-filtered authorized-children
 * endpoint; tests = an in-memory fake. This keeps the security predicate
 * server-side and unit-testable with no live network, mirroring the tenant
 * service's OffboardingPorts and analytics' resolveCaller patterns.
 */

/** One child a guardian is currently authorized to view (active link + consent). */
export interface GuardianChild {
  studentUserId: string;
  /** parent | guardian | other — for display only, NOT an authz input. */
  relationship: string;
}

/**
 * Resolves the set of students a guardian may currently read, for THIS tenant.
 * The boundary contract: the resolver returns ONLY children whose
 * guardian_relationship.status = 'active' AND whose gating consent
 * (GUARDIAN_CONSENT_CATEGORY = 'directory_information') is currently satisfied —
 * i.e. consent is fully evaluated upstream (user-org owns parental_consent +
 * evaluateGuardianConsent). Attendance does NOT re-derive consent; it trusts the
 * port's filtered set and treats "not in the set" as deny. An empty array means
 * "no authorized children" (a valid, non-error result → empty history list).
 */
export interface GuardianChildrenResolver {
  resolveChildren(
    ctx: TenantContext,
    guardianUserId: string,
  ): Promise<GuardianChild[]>;
}
