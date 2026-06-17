import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  DecideResult,
  PolicyInput,
  RegistrationPolicy,
  RegistrationRequest,
  RequestStatus,
  SelfRegisterResult,
  SelfRegistrationStore,
} from "./selfreg.js";

interface StoredPolicy extends RegistrationPolicy {
  tenantId: string;
}

/**
 * In-memory self-registration store. Tracks policies, requests and active
 * enrollments (for capacity) keyed by tenant to emulate RLS. A `learner` role
 * is assumed to exist (the Prisma store checks the per-tenant role table).
 */
export class MemorySelfRegStore implements SelfRegistrationStore {
  private policies: StoredPolicy[] = [];
  private requests: RegistrationRequest[] = [];
  /** Active enrollments as `${tenantId}:${orgUnitId}:${userId}`. */
  private enrolled = new Set<string>();

  constructor(private readonly generateId: () => string = randomUUID) {}

  /** Seed an existing active enrollment (e.g. to pre-fill a section's seats). */
  seedEnrollment(tenantId: string, orgUnitId: string, userId: string): void {
    this.enrolled.add(`${tenantId}:${orgUnitId}:${userId}`);
  }

  private policy(ctx: TenantContext, orgUnitId: string): StoredPolicy | undefined {
    return this.policies.find(
      (p) => p.tenantId === ctx.tenantId && p.orgUnitId === orgUnitId,
    );
  }
  private activeCount(ctx: TenantContext, orgUnitId: string): number {
    const prefix = `${ctx.tenantId}:${orgUnitId}:`;
    let n = 0;
    for (const k of this.enrolled) if (k.startsWith(prefix)) n += 1;
    return n;
  }
  private toPolicy(p: StoredPolicy): RegistrationPolicy {
    return {
      orgUnitId: p.orgUnitId,
      isOpen: p.isOpen,
      requiresApproval: p.requiresApproval,
      capacity: p.capacity,
    };
  }

  async getPolicy(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<RegistrationPolicy | null> {
    const p = this.policy(ctx, orgUnitId);
    return p ? this.toPolicy(p) : null;
  }

  async setPolicy(
    ctx: TenantContext,
    orgUnitId: string,
    input: PolicyInput,
  ): Promise<RegistrationPolicy> {
    let p = this.policy(ctx, orgUnitId);
    if (!p) {
      p = {
        tenantId: ctx.tenantId,
        orgUnitId,
        isOpen: false,
        requiresApproval: false,
        capacity: null,
      };
      this.policies.push(p);
    }
    if (input.isOpen !== undefined) p.isOpen = input.isOpen;
    if (input.requiresApproval !== undefined) p.requiresApproval = input.requiresApproval;
    if (input.capacity !== undefined) p.capacity = input.capacity;
    return this.toPolicy(p);
  }

  private upsertRequest(
    ctx: TenantContext,
    orgUnitId: string,
    userId: string,
    status: RequestStatus,
    decided: boolean,
  ): RegistrationRequest {
    let req = this.requests.find(
      (r) =>
        r.tenantId === ctx.tenantId &&
        r.orgUnitId === orgUnitId &&
        r.userId === userId,
    );
    const nowIso = new Date(0).toISOString();
    if (!req) {
      req = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        orgUnitId,
        userId,
        status,
        createdAt: nowIso,
        decidedAt: decided ? nowIso : null,
        decidedBy: null,
      };
      this.requests.push(req);
    } else {
      req.status = status;
      if (decided) req.decidedAt = nowIso;
    }
    return { ...req };
  }

  async selfRegister(
    ctx: TenantContext,
    orgUnitId: string,
    userId: string,
  ): Promise<SelfRegisterResult> {
    const policy = this.policy(ctx, orgUnitId);
    if (!policy || !policy.isOpen) return { ok: false, reason: "closed" };
    if (this.enrolled.has(`${ctx.tenantId}:${orgUnitId}:${userId}`)) {
      return { ok: false, reason: "already_enrolled" };
    }
    const atCapacity =
      policy.capacity !== null &&
      this.activeCount(ctx, orgUnitId) >= policy.capacity;

    if (policy.requiresApproval || atCapacity) {
      return {
        ok: true,
        outcome: "pending",
        request: this.upsertRequest(ctx, orgUnitId, userId, "pending", false),
      };
    }
    this.enrolled.add(`${ctx.tenantId}:${orgUnitId}:${userId}`);
    return {
      ok: true,
      outcome: "enrolled",
      request: this.upsertRequest(ctx, orgUnitId, userId, "approved", true),
    };
  }

  async listRequests(
    ctx: TenantContext,
    orgUnitId: string,
    status?: RequestStatus,
  ): Promise<RegistrationRequest[]> {
    return this.requests
      .filter(
        (r) =>
          r.tenantId === ctx.tenantId &&
          r.orgUnitId === orgUnitId &&
          (status === undefined || r.status === status),
      )
      .map((r) => ({ ...r }));
  }

  async decide(
    ctx: TenantContext,
    requestId: string,
    decision: "approve" | "deny",
    decidedBy: string | null = null,
  ): Promise<DecideResult> {
    const req = this.requests.find(
      (r) => r.id === requestId && r.tenantId === ctx.tenantId,
    );
    if (!req) return { ok: false, reason: "not_found" };
    if (req.status !== "pending") return { ok: false, reason: "not_pending" };

    if (decision === "deny") {
      req.status = "denied";
      req.decidedAt = new Date(0).toISOString();
      req.decidedBy = decidedBy;
      return { ok: true, outcome: "denied", request: { ...req } };
    }
    const policy = this.policy(ctx, req.orgUnitId);
    if (
      policy?.capacity != null &&
      this.activeCount(ctx, req.orgUnitId) >= policy.capacity
    ) {
      return { ok: false, reason: "at_capacity" };
    }
    this.enrolled.add(`${ctx.tenantId}:${req.orgUnitId}:${req.userId}`);
    req.status = "approved";
    req.decidedAt = new Date(0).toISOString();
    req.decidedBy = decidedBy;
    return { ok: true, outcome: "enrolled", request: { ...req } };
  }
}
