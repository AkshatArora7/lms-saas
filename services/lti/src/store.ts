import type { TenantContext } from "@lms/types";

/**
 * Tenant-scoped persistence for LTI 1.3 Resource Link launches (issue #10).
 * Every method is RLS-scoped (the Prisma impl runs through `withTenant`); the
 * memory impl emulates the same tenant filtering for tests.
 */

export type LtiRole = "platform" | "tool";

/** A trusted remote platform this sub-tenant launches from. */
export interface LtiRegistration {
  id: string;
  tenantId: string;
  issuer: string;
  clientId: string;
  authLoginUrl: string;
  authTokenUrl: string;
  jwksUrl: string;
  role: LtiRole;
}

/** A deployment of this tool under a registration. */
export interface LtiDeployment {
  id: string;
  deploymentId: string;
  orgUnitId: string | null;
}

/** OIDC login state/nonce row (single-use, replay-protected). */
export interface LtiLaunchSession {
  id: string;
  tenantId: string;
  registrationId: string;
  state: string;
  nonce: string;
  targetLinkUri: string | null;
  ltiMessageHint: string | null;
  consumedAt: string | null;
  expiresAt: string;
}

export interface NewLaunchSession {
  registrationId: string;
  state: string;
  nonce: string;
  targetLinkUri?: string | null;
  ltiMessageHint?: string | null;
  /** Lifetime in seconds; defaults to ~10 min. */
  ttlSeconds?: number;
}

export type NewRegistration = Omit<LtiRegistration, "id" | "tenantId">;

/** Default launch-session lifetime (seconds). */
export const DEFAULT_LAUNCH_TTL_SECONDS = 600;

export interface LtiStore {
  /** OIDC login: find the tenant's registration by (issuer, client_id). */
  findRegistration(
    ctx: TenantContext,
    issuer: string,
    clientId: string,
  ): Promise<LtiRegistration | null>;

  /** Find the tenant's registration by id (after a launch session is consumed). */
  getRegistrationById(
    ctx: TenantContext,
    registrationId: string,
  ): Promise<LtiRegistration | null>;

  /** Verify the deployment_id from the id_token belongs to the registration. */
  getDeployment(
    ctx: TenantContext,
    registrationId: string,
    deploymentId: string,
  ): Promise<LtiDeployment | null>;

  /** Persist state+nonce at /lti/login. */
  createLaunchSession(
    ctx: TenantContext,
    s: NewLaunchSession,
  ): Promise<LtiLaunchSession>;

  /**
   * Atomic single-use burn at /lti/launch: returns the row only if it was
   * unconsumed AND unexpired, marking it consumed in the same step. Returns
   * null on replay / expiry / unknown state.
   */
  consumeLaunchSession(
    ctx: TenantContext,
    state: string,
  ): Promise<LtiLaunchSession | null>;

  /** Admin: register a platform the sub-tenant launches from. */
  createRegistration(
    ctx: TenantContext,
    r: NewRegistration,
  ): Promise<LtiRegistration>;
}
