import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  CreateRelationshipInput,
  CreateRelationshipResult,
  GuardianRelationshipRecord,
  GuardianStore,
} from "./guardian.js";

/**
 * In-memory guardian-relationship store. Rows are filtered by tenant id to
 * emulate the RLS isolation Postgres enforces on `guardian_relationship`.
 * The UNIQUE(tenant_id, guardian_user_id, student_user_id) constraint is
 * mirrored by the link-exists check. User existence (the FKs to `app_user` in
 * the real table) is validated through an injectable predicate so tests can
 * exercise the not-found paths without standing up the full user store; it
 * defaults to "exists" for dev convenience.
 */
export class MemoryGuardianStore implements GuardianStore {
  private rows: GuardianRelationshipRecord[] = [];

  constructor(
    private readonly userExists: (
      ctx: TenantContext,
      userId: string,
    ) => boolean = () => true,
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createRelationship(
    ctx: TenantContext,
    input: CreateRelationshipInput,
  ): Promise<CreateRelationshipResult> {
    if (!this.userExists(ctx, input.guardianUserId)) {
      return { ok: false, reason: "guardian_not_found" };
    }
    if (!this.userExists(ctx, input.studentUserId)) {
      return { ok: false, reason: "student_not_found" };
    }
    const duplicate = this.rows.find(
      (r) =>
        r.tenantId === ctx.tenantId &&
        r.guardianUserId === input.guardianUserId &&
        r.studentUserId === input.studentUserId,
    );
    if (duplicate) return { ok: false, reason: "link_exists" };

    const ts = this.now().toISOString();
    const relationship: GuardianRelationshipRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      guardianUserId: input.guardianUserId,
      studentUserId: input.studentUserId,
      relationship: input.relationship ?? "guardian",
      status: "pending",
      consentId: null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: ts,
      updatedAt: ts,
      revokedAt: null,
    };
    this.rows.push(relationship);
    return { ok: true, relationship };
  }

  async listGuardiansForStudent(
    ctx: TenantContext,
    studentUserId: string,
  ): Promise<GuardianRelationshipRecord[]> {
    return this.rows.filter(
      (r) => r.tenantId === ctx.tenantId && r.studentUserId === studentUserId,
    );
  }

  async listStudentsForGuardian(
    ctx: TenantContext,
    guardianUserId: string,
  ): Promise<GuardianRelationshipRecord[]> {
    return this.rows.filter(
      (r) => r.tenantId === ctx.tenantId && r.guardianUserId === guardianUserId,
    );
  }

  async getRelationshipById(
    ctx: TenantContext,
    id: string,
  ): Promise<GuardianRelationshipRecord | null> {
    return (
      this.rows.find((r) => r.id === id && r.tenantId === ctx.tenantId) ?? null
    );
  }

  async activateRelationship(
    ctx: TenantContext,
    id: string,
    consentId: string | null,
  ): Promise<GuardianRelationshipRecord | null> {
    const row = this.rows.find(
      (r) => r.id === id && r.tenantId === ctx.tenantId,
    );
    if (!row) return null;
    row.status = "active";
    row.consentId = consentId;
    row.updatedAt = this.now().toISOString();
    return row;
  }

  async revokeRelationship(
    ctx: TenantContext,
    id: string,
  ): Promise<GuardianRelationshipRecord | null> {
    const row = this.rows.find(
      (r) => r.id === id && r.tenantId === ctx.tenantId,
    );
    if (!row) return null;
    row.status = "revoked";
    row.revokedAt = this.now().toISOString();
    row.updatedAt = this.now().toISOString();
    return row;
  }

  async getRelationship(
    ctx: TenantContext,
    guardianUserId: string,
    studentUserId: string,
  ): Promise<GuardianRelationshipRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.tenantId === ctx.tenantId &&
          r.guardianUserId === guardianUserId &&
          r.studentUserId === studentUserId,
      ) ?? null
    );
  }
}
