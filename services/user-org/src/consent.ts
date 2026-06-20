import type { TenantContext } from "@lms/types";

/**
 * COPPA/age-appropriate handling (issue #77).
 *
 * Age is stored as a coarse *band* (not a date of birth) to minimise PII while
 * still gating data handling for minors. Verifiable parental consent is captured
 * per data category; the pure {@link dataCollectionDecision} policy answers
 * "may we collect/share this category for this subject?" from the age band plus
 * the consents on file. The store persists one row per (subject, consent_type),
 * tenant-scoped under RLS.
 */

export type AgeBand = "under_13" | "13_17" | "adult" | "unknown";
export const AGE_BANDS: readonly AgeBand[] = [
  "under_13",
  "13_17",
  "adult",
  "unknown",
];

export type ConsentType =
  | "data_collection"
  | "third_party_sharing"
  | "directory_information"
  | "ai_features";
export const CONSENT_TYPES: readonly ConsentType[] = [
  "data_collection",
  "third_party_sharing",
  "directory_information",
  "ai_features",
];

export type ConsentStatus = "pending" | "granted" | "revoked";
export const CONSENT_STATUSES: readonly ConsentStatus[] = [
  "pending",
  "granted",
  "revoked",
];

export type ConsentMethod =
  | "verifiable_email"
  | "signed_form"
  | "in_person"
  | "none";
export const CONSENT_METHODS: readonly ConsentMethod[] = [
  "verifiable_email",
  "signed_form",
  "in_person",
  "none",
];

export interface ConsentRecord {
  id: string;
  tenantId: string;
  subjectUserId: string;
  ageBand: AgeBand;
  consentType: ConsentType;
  status: ConsentStatus;
  guardianName: string | null;
  guardianEmail: string | null;
  method: ConsentMethod | null;
  recordedBy: string | null;
  recordedAt: string;
  revokedAt: string | null;
}

export interface RecordConsentInput {
  subjectUserId: string;
  ageBand: AgeBand;
  consentType: ConsentType;
  status?: ConsentStatus;
  guardianName?: string | null;
  guardianEmail?: string | null;
  method?: ConsentMethod | null;
  recordedBy?: string | null;
}

/** True for school-age minors (COPPA <13; FERPA-sensitive 13–17). */
export function isMinor(band: AgeBand): boolean {
  return band === "under_13" || band === "13_17";
}

export interface DataPolicyDecision {
  subjectUserId: string;
  ageBand: AgeBand;
  category: ConsentType;
  /** Whether collecting/sharing this category is currently permitted. */
  allowed: boolean;
  /** Whether this category needs verifiable consent for this age band. */
  requiresConsent: boolean;
  reason: string;
}

/**
 * Does a category require consent for an age band?
 * - under_13: everything requires verifiable parental consent (COPPA).
 * - 13_17: sharing/directory/AI require consent; basic data_collection is allowed.
 * - unknown: be conservative — treat outbound/AI categories as consent-gated.
 * - adult: nothing is age-gated.
 */
function requiresConsentFor(band: AgeBand, category: ConsentType): boolean {
  if (band === "adult") return false;
  if (band === "under_13") return true;
  // 13_17 and unknown: only the non-basic categories are gated.
  return category !== "data_collection";
}

/**
 * Pure policy decision for collecting/sharing one data category for a subject.
 * `grantedConsents` is the set of consent types currently granted for them.
 */
export function dataCollectionDecision(args: {
  subjectUserId: string;
  ageBand: AgeBand;
  category: ConsentType;
  grantedConsents: ConsentType[];
}): DataPolicyDecision {
  const requiresConsent = requiresConsentFor(args.ageBand, args.category);
  const granted = args.grantedConsents.includes(args.category);
  const allowed = !requiresConsent || granted;
  const reason = !requiresConsent
    ? "No age-based restriction for this category."
    : granted
      ? "Verifiable parental consent is on file."
      : args.ageBand === "under_13"
        ? "COPPA: verifiable parental consent is required before collecting data for under-13 users."
        : "Consent is required for this category for minors.";
  return {
    subjectUserId: args.subjectUserId,
    ageBand: args.ageBand,
    category: args.category,
    allowed,
    requiresConsent,
    reason,
  };
}

/** Tenant-scoped parental-consent persistence (RLS via withTenant). */
export interface ConsentStore {
  /** Upsert the consent for a (subject, consent_type). */
  recordConsent(
    ctx: TenantContext,
    input: RecordConsentInput,
  ): Promise<ConsentRecord>;

  /** Revoke a consent by id; returns the updated row or null if not found. */
  revokeConsent(
    ctx: TenantContext,
    id: string,
  ): Promise<ConsentRecord | null>;

  /** All consents for a subject. */
  listConsents(
    ctx: TenantContext,
    subjectUserId: string,
  ): Promise<ConsentRecord[]>;

  /** The subject's known age band (latest recorded), or 'unknown'. */
  getAgeBand(ctx: TenantContext, subjectUserId: string): Promise<AgeBand>;
}
