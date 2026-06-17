import type { TenantContext } from "@lms/types";

/** Per-section self-registration policy. */
export interface RegistrationPolicy {
  orgUnitId: string;
  isOpen: boolean;
  requiresApproval: boolean;
  /** Seat cap; null = unlimited. Requests over capacity wait-list as pending. */
  capacity: number | null;
}

export interface PolicyInput {
  isOpen?: boolean;
  requiresApproval?: boolean;
  capacity?: number | null;
}

export type RequestStatus = "pending" | "approved" | "denied";

export interface RegistrationRequest {
  id: string;
  tenantId: string;
  orgUnitId: string;
  userId: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

/** Outcome of a self-registration attempt. */
export type SelfRegisterResult =
  | {
      ok: true;
      /** `enrolled` = active immediately; `pending` = awaiting approval/seat. */
      outcome: "enrolled" | "pending";
      request: RegistrationRequest;
    }
  | {
      ok: false;
      reason: "closed" | "already_enrolled" | "unknown_role";
    };

export type DecideResult =
  | { ok: true; outcome: "enrolled" | "denied"; request: RegistrationRequest }
  | { ok: false; reason: "not_found" | "not_pending" | "at_capacity" | "unknown_role" };

/**
 * Persistence boundary for self-registration. Separate from the core enrollment
 * store so that path is untouched; both are RLS-scoped via withTenant.
 */
export interface SelfRegistrationStore {
  getPolicy(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<RegistrationPolicy | null>;

  setPolicy(
    ctx: TenantContext,
    orgUnitId: string,
    input: PolicyInput,
  ): Promise<RegistrationPolicy>;

  /**
   * A learner requests a seat. Enrolls immediately when the section is open,
   * needs no approval, and has capacity; otherwise records a pending request
   * (approval queue or wait-list).
   */
  selfRegister(
    ctx: TenantContext,
    orgUnitId: string,
    userId: string,
  ): Promise<SelfRegisterResult>;

  listRequests(
    ctx: TenantContext,
    orgUnitId: string,
    status?: RequestStatus,
  ): Promise<RegistrationRequest[]>;

  /** Approve (enrolls if seats remain) or deny a pending request. */
  decide(
    ctx: TenantContext,
    requestId: string,
    decision: "approve" | "deny",
    decidedBy?: string | null,
  ): Promise<DecideResult>;
}
