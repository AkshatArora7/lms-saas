import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  CreateEnrollmentResult,
  EnrollmentRecord,
  EnrollmentStore,
  NewEnrollmentInput,
  UpdateEnrollmentResult,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Shape accepted by `seed`. The Prisma store resolves `displayName`/`email` via
 * a LEFT JOIN on `app_user`; the memory store has no such table, so callers may
 * model the resolved name/email as data alongside the enrollment (defaulting to
 * null when omitted, matching an unmatched LEFT JOIN row).
 */
export type SeedEnrollment = Omit<EnrollmentRecord, "displayName" | "email"> &
  Partial<Pick<EnrollmentRecord, "displayName" | "email">>;

/** Roles a tenant is assumed to have; mirrors the seeded per-tenant role set. */
export const KNOWN_ROLES: readonly string[] = [
  "learner",
  "instructor",
  "teaching_assistant",
  "course_builder",
  "observer",
  "org_admin",
];

/**
 * In-memory EnrollmentStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `ENROLLMENT_STORE=memory`. Role validity is checked against
 * KNOWN_ROLES (the Prisma store checks the per-tenant `role` table instead).
 */
export class MemoryEnrollmentStore implements EnrollmentStore {
  private enrollments: EnrollmentRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
    private readonly knownRoles: readonly string[] = KNOWN_ROLES,
  ) {}

  seed(enrollment: SeedEnrollment): void {
    this.enrollments.push({
      displayName: null,
      email: null,
      ...enrollment,
    });
  }

  async createEnrollment(
    ctx: TenantContext,
    input: NewEnrollmentInput,
  ): Promise<CreateEnrollmentResult> {
    if (!this.knownRoles.includes(input.role)) {
      return { ok: false, reason: "unknown_role" };
    }
    const duplicate = this.enrollments.some(
      (e) =>
        e.tenantId === ctx.tenantId &&
        e.userId === input.userId &&
        e.orgUnitId === input.orgUnitId,
    );
    if (duplicate) return { ok: false, reason: "already_enrolled" };

    const enrollment: EnrollmentRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      userId: input.userId,
      orgUnitId: input.orgUnitId,
      role: input.role,
      status: "active",
      enrolledAt: this.now().toISOString(),
      // The memory store has no app_user table; created rows have no resolved
      // user, so name/email are null (only seeded rows can carry them).
      displayName: null,
      email: null,
    };
    this.enrollments.push(enrollment);
    return { ok: true, enrollment };
  }

  async getEnrollment(
    ctx: TenantContext,
    id: string,
  ): Promise<EnrollmentRecord | null> {
    return (
      this.enrollments.find(
        (e) => e.id === id && e.tenantId === ctx.tenantId,
      ) ?? null
    );
  }

  private async transition(
    ctx: TenantContext,
    id: string,
    status: EnrollmentRecord["status"],
  ): Promise<EnrollmentRecord | null> {
    const enrollment = this.enrollments.find(
      (e) => e.id === id && e.tenantId === ctx.tenantId,
    );
    if (!enrollment) return null;
    enrollment.status = status;
    return enrollment;
  }

  async dropEnrollment(
    ctx: TenantContext,
    id: string,
  ): Promise<EnrollmentRecord | null> {
    return this.transition(ctx, id, "withdrawn");
  }

  async updateEnrollmentRole(
    ctx: TenantContext,
    id: string,
    role: string,
  ): Promise<UpdateEnrollmentResult> {
    if (!this.knownRoles.includes(role)) {
      return { ok: false, reason: "unknown_role" };
    }
    const enrollment = this.enrollments.find(
      (e) => e.id === id && e.tenantId === ctx.tenantId,
    );
    if (!enrollment) return { ok: false, reason: "not_found" };
    enrollment.role = role;
    return { ok: true, enrollment };
  }

  async completeEnrollment(
    ctx: TenantContext,
    id: string,
  ): Promise<EnrollmentRecord | null> {
    return this.transition(ctx, id, "completed");
  }

  async getRoster(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<EnrollmentRecord[]> {
    return this.enrollments.filter(
      (e) =>
        e.tenantId === ctx.tenantId &&
        e.orgUnitId === orgUnitId &&
        e.status === "active",
    );
  }

  async listForUser(
    ctx: TenantContext,
    userId: string,
  ): Promise<EnrollmentRecord[]> {
    return this.enrollments.filter(
      (e) => e.tenantId === ctx.tenantId && e.userId === userId,
    );
  }
}

/** Build a MemoryEnrollmentStore pre-seeded with a demo enrollment. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryEnrollmentStore {
  const store = new MemoryEnrollmentStore(generateId, now);
  store.seed({
    id: "demo-enrollment-1",
    tenantId: DEMO_TENANT_ID,
    userId: "demo-student",
    orgUnitId: "demo-section",
    role: "learner",
    status: "active",
    enrolledAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  });
  // Active roster for a teacher demo course (alg-101) so the instructor roster
  // console renders a real, populated section in local dev.
  store.seed({
    id: "demo-alg-enr-1",
    tenantId: DEMO_TENANT_ID,
    userId: "ada.lovelace",
    orgUnitId: "alg-101",
    role: "learner",
    status: "active",
    enrolledAt: new Date("2026-01-05T00:00:00.000Z").toISOString(),
    displayName: "Ada Lovelace",
    email: "ada.lovelace@demo.edu",
  });
  store.seed({
    id: "demo-alg-enr-2",
    tenantId: DEMO_TENANT_ID,
    userId: "alan.turing",
    orgUnitId: "alg-101",
    role: "learner",
    status: "active",
    enrolledAt: new Date("2026-01-06T00:00:00.000Z").toISOString(),
    displayName: "Alan Turing",
    email: "alan.turing@demo.edu",
  });
  store.seed({
    id: "demo-alg-enr-3",
    tenantId: DEMO_TENANT_ID,
    userId: "grace.hopper",
    orgUnitId: "alg-101",
    role: "teaching_assistant",
    status: "active",
    enrolledAt: new Date("2026-01-07T00:00:00.000Z").toISOString(),
    displayName: "Grace Hopper",
    email: "grace.hopper@demo.edu",
  });
  return store;
}
