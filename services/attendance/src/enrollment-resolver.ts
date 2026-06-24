import type { TenantContext } from "@lms/types";

/**
 * Enrollment-roster port (#376).
 *
 * The class-meeting roster is authoritative in the enrollment bounded context
 * (`enrollment` owns `enrollment` rows + `getRoster`, which returns only the
 * active members of a section). Attendance must NOT re-derive enrollment or
 * JOIN across contexts inside `withTenant`; instead it asks enrollment "who is
 * actively enrolled in this section?" through this injected port and seeds one
 * `attendance_record` per returned student. Prod = HTTP to enrollment's roster
 * endpoint through the gateway; tests = an in-memory fake. This mirrors the
 * guardian-resolver trio (#190) exactly.
 *
 * Implementations MUST fail closed: on any error (HTTP non-2xx, network
 * failure, parse error) they return `[]`, so the session is still created with
 * an empty roster (the teacher can add records manually) rather than failing or
 * leaking.
 */

/** One actively-enrolled student of a section. Only the user id is needed. */
export interface RosterStudent {
  userId: string;
}

/**
 * Resolves the set of actively-enrolled students of a section, for THIS tenant.
 * The boundary contract: the resolver returns ONLY rows whose enrollment
 * `status = 'active'` — enrollment owns and applies that filter upstream
 * (`getRoster`). Attendance trusts the returned set. An empty array means "no
 * roster" (a valid, non-error result → a session with no seeded records).
 */
export interface EnrollmentRosterResolver {
  resolveRoster(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<RosterStudent[]>;
}
