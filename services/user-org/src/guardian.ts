import type { TenantContext } from "@lms/types";

import {
  dataCollectionDecision,
  type AgeBand,
  type ConsentType,
  type DataPolicyDecision,
} from "./consent.js";

/**
 * Guardian/parent relationships (issue #24).
 *
 * A guardian (a parent/guardian `app_user`) is linked to a student (`app_user`)
 * within a tenant, with **read-only**, consent-gated access to the child's
 * scoped data. The link is modelled by the tenant-scoped `guardian_relationship`
 * table; the *live* access gate is re-derived from `parental_consent` at request
 * time via the pure {@link dataCollectionDecision} policy (so a later consent
 * revoke denies immediately without mutating the relationship).
 *
 * Read-only is enforced by construction: the only guardian-facing surface is the
 * read-only authorization predicate. Create/activate/revoke are admin/staff
 * operations — no route ever gives a guardian a write path to the child's data.
 */

export type GuardianKind = "parent" | "guardian" | "other";
export const GUARDIAN_KINDS: readonly GuardianKind[] = [
  "parent",
  "guardian",
  "other",
];

export type GuardianStatus = "pending" | "active" | "revoked";
export const GUARDIAN_STATUSES: readonly GuardianStatus[] = [
  "pending",
  "active",
  "revoked",
];

export interface GuardianRelationshipRecord {
  id: string;
  tenantId: string;
  guardianUserId: string;
  studentUserId: string;
  relationship: GuardianKind;
  status: GuardianStatus;
  /** Provenance only: the parental_consent row used to activate (NOT the live gate). */
  consentId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface CreateRelationshipInput {
  guardianUserId: string;
  studentUserId: string;
  relationship?: GuardianKind;
  note?: string | null;
  createdBy?: string | null;
}

/** Discriminated result for create — both users must exist; link is unique. */
export type CreateRelationshipResult =
  | { ok: true; relationship: GuardianRelationshipRecord }
  | { ok: false; reason: "guardian_not_found" | "student_not_found" | "link_exists" };

/** The consent category that gates guardian access to a student's scoped data. */
export const GUARDIAN_CONSENT_CATEGORY: ConsentType = "directory_information";

export interface GuardianAuthorizeDecision {
  allowed: boolean;
  reason: string;
  relationshipStatus: GuardianStatus | "none";
  ageBand: AgeBand;
  consentSatisfied: boolean;
}

/**
 * Pure consent/age gate shared by activation and the live authorize predicate.
 * `adult` students are not age-gated (consent is satisfied by construction —
 * the link is an explicit out-of-band approval); minors/unknown require the
 * gating consent category to be currently granted (re-derived per request so a
 * later consent revoke denies immediately).
 */
export function evaluateGuardianConsent(args: {
  studentUserId: string;
  ageBand: AgeBand;
  category: ConsentType;
  grantedConsents: ConsentType[];
}): { consentSatisfied: boolean; decision: DataPolicyDecision } {
  if (args.ageBand === "adult") {
    return {
      consentSatisfied: true,
      decision: {
        subjectUserId: args.studentUserId,
        ageBand: args.ageBand,
        category: args.category,
        allowed: true,
        requiresConsent: false,
        reason: "Adult student: no age-based consent gate for this category.",
      },
    };
  }
  const decision = dataCollectionDecision({
    subjectUserId: args.studentUserId,
    ageBand: args.ageBand,
    category: args.category,
    grantedConsents: args.grantedConsents,
  });
  return { consentSatisfied: decision.allowed, decision };
}

/** Tenant-scoped guardian-relationship persistence (RLS via withTenant). */
export interface GuardianStore {
  /** Create a pending link (validates both app_user rows exist; unique). */
  createRelationship(
    ctx: TenantContext,
    input: CreateRelationshipInput,
  ): Promise<CreateRelationshipResult>;

  /** All relationships where the given user is the student. */
  listGuardiansForStudent(
    ctx: TenantContext,
    studentUserId: string,
  ): Promise<GuardianRelationshipRecord[]>;

  /** All relationships where the given user is the guardian. */
  listStudentsForGuardian(
    ctx: TenantContext,
    guardianUserId: string,
  ): Promise<GuardianRelationshipRecord[]>;

  /** Fetch a single relationship by id (tenant-scoped), or null. */
  getRelationshipById(
    ctx: TenantContext,
    id: string,
  ): Promise<GuardianRelationshipRecord | null>;

  /** Activate a link: set status='active' and stamp the provenance consent id. */
  activateRelationship(
    ctx: TenantContext,
    id: string,
    consentId: string | null,
  ): Promise<GuardianRelationshipRecord | null>;

  /** Soft-revoke: set status='revoked' and stamp revoked_at. */
  revokeRelationship(
    ctx: TenantContext,
    id: string,
  ): Promise<GuardianRelationshipRecord | null>;

  /** The active/any relationship for a (guardian, student) pair — for the predicate. */
  getRelationship(
    ctx: TenantContext,
    guardianUserId: string,
    studentUserId: string,
  ): Promise<GuardianRelationshipRecord | null>;
}
