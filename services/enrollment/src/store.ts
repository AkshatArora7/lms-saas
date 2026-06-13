import type { TenantContext } from "@lms/types";

export type EnrollmentStatus =
  | "active"
  | "inactive"
  | "completed"
  | "withdrawn";

/** A user's membership in a section (org unit) with a role. */
export interface EnrollmentRecord {
  id: string;
  tenantId: string;
  userId: string;
  orgUnitId: string;
  role: string;
  status: EnrollmentStatus;
  enrolledAt: string;
}

export interface NewEnrollmentInput {
  userId: string;
  orgUnitId: string;
  /** Per-tenant role name, e.g. "learner", "instructor", "teaching_assistant". */
  role: string;
}

export type CreateEnrollmentResult =
  | { ok: true; enrollment: EnrollmentRecord }
  | { ok: false; reason: "already_enrolled" | "unknown_role" };

/**
 * Persistence boundary for the enrollment service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the course/calendar/attendance
 * services.
 */
export interface EnrollmentStore {
  /** Enroll a user in a section with a role; rejects duplicates/unknown roles. */
  createEnrollment(
    ctx: TenantContext,
    input: NewEnrollmentInput,
  ): Promise<CreateEnrollmentResult>;

  getEnrollment(
    ctx: TenantContext,
    id: string,
  ): Promise<EnrollmentRecord | null>;

  /** Withdraw an enrollment (lifecycle transition); returns the updated record. */
  dropEnrollment(
    ctx: TenantContext,
    id: string,
  ): Promise<EnrollmentRecord | null>;

  /** Mark an enrollment completed; returns the updated record. */
  completeEnrollment(
    ctx: TenantContext,
    id: string,
  ): Promise<EnrollmentRecord | null>;

  /** Active roster for a section. */
  getRoster(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<EnrollmentRecord[]>;

  /** All of a user's enrollments (any status). */
  listForUser(
    ctx: TenantContext,
    userId: string,
  ): Promise<EnrollmentRecord[]>;
}
