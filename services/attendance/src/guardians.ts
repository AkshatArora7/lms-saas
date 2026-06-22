import type { TenantContext } from "@lms/types";

/**
 * Port for resolving a student's notifiable guardians (#101). Attendance must
 * NOT re-derive guardian relationships or consent — that logic lives in the
 * user-org bounded context. This port asks user-org "who are S's authorized
 * guardians?" and consumes the already-filtered answer.
 *
 * Implementations MUST fail closed: on any error (HTTP non-2xx, network failure,
 * parse error, unsatisfied consent) they return `[]`, so the notification
 * fan-out degrades to learner-only rather than over-notifying or leaking.
 */
export interface StudentGuardiansResolver {
  /**
   * Active + consent-satisfied guardians of the student, tenant-scoped.
   * MUST fail closed (return []) on any error.
   */
  resolveGuardians(
    ctx: TenantContext,
    studentUserId: string,
  ): Promise<{ guardianUserId: string }[]>;
}
