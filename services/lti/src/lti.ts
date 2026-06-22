import type { KeyLike } from "jose";

import type { StandardRole } from "@lms/types";

/**
 * Pure LTI 1.3 Resource Link launch logic (issue #10): claim constants, the
 * injectable JWKS/clock ports, the side-effect-free claim validator, and the
 * LTI-role → StandardRole mapping. NO IO here — signature verification (the only
 * async/network-adjacent step) lives in the route via an injected resolver, so
 * everything in this module unit-tests without a server, a database, or a clock.
 */

// --- Ports (injected; prod wraps jose.createRemoteJWKSet + real Date) ---------

/**
 * Resolves a verification key from the platform JWKS for a given id_token
 * header. Matches jose's key-resolver signature so it can be passed straight
 * into `jose.jwtVerify(token, resolver, ...)`. Prod wraps
 * `jose.createRemoteJWKSet(new URL(jwksUrl))`; tests inject one backed by a
 * locally generated public key (`jose.createLocalJWKSet`).
 */
export interface JwksResolver {
  (
    protectedHeader: { kid?: string; alg?: string },
    token: unknown,
  ): Promise<KeyLike | Uint8Array>;
}

/** One resolver per registration (cache by jwks_url in prod). */
export interface JwksResolverFactory {
  forJwksUrl(jwksUrl: string): JwksResolver;
}

/** Single source of "now". Prod = () => new Date(); tests = a fixed clock. */
export type Clock = () => Date;

// --- LTI 1.3 claim constants --------------------------------------------------

export const LTI_VERSION = "1.3.0";
export const MSG_TYPE_RESOURCE_LINK = "LtiResourceLinkRequest";

export const CLAIM = {
  messageType: "https://purl.imsglobal.org/spec/lti/claim/message_type",
  version: "https://purl.imsglobal.org/spec/lti/claim/version",
  deploymentId: "https://purl.imsglobal.org/spec/lti/claim/deployment_id",
  roles: "https://purl.imsglobal.org/spec/lti/claim/roles",
  context: "https://purl.imsglobal.org/spec/lti/claim/context",
  resourceLink: "https://purl.imsglobal.org/spec/lti/claim/resource_link",
  targetLinkUri: "https://purl.imsglobal.org/spec/lti/claim/target_link_uri",
} as const;

// --- Role mapping (DECISION 4) ------------------------------------------------

/**
 * Most→least privileged. The single effective `primary` returned by
 * `mapLtiRoles` is the highest-privilege role granted. `super_admin` is NEVER
 * granted from an LTI launch.
 */
const ROLE_PRECEDENCE: readonly StandardRole[] = [
  "org_admin",
  "instructor",
  "course_builder",
  "teaching_assistant",
  "observer",
  "learner",
];

/**
 * Map a single LTI role URN (or short form) to a StandardRole by case-insensitive
 * suffix match on the role segment. Returns null when nothing matches.
 */
function mapOne(ltiRole: string): StandardRole | null {
  // Take the segment after the last `#`, `/`, or `:` and lowercase it.
  const seg = (ltiRole.split(/[#/:]/).pop() ?? ltiRole).trim().toLowerCase();
  if (seg === "administrator") return "org_admin";
  if (seg === "instructor") return "instructor";
  if (seg === "contentdeveloper") return "course_builder";
  if (seg === "teachingassistant") return "teaching_assistant";
  if (seg === "mentor") return "observer"; // guardian/mentor → observer
  if (seg === "learner" || seg === "student") return "learner";
  if (seg === "observer") return "observer";
  return null;
}

export interface MappedRoles {
  /** Deduped set of StandardRoles actually granted, in precedence order. */
  roles: StandardRole[];
  /** The single highest-privilege role used for the session. */
  primary: StandardRole;
}

/**
 * Map LTI `roles` claim URNs to StandardRoles. Unmatched roles are ignored;
 * if nothing matches we fall back to `learner` (least privilege for a launch).
 */
export function mapLtiRoles(ltiRoles: string[]): MappedRoles {
  const granted = new Set<StandardRole>();
  for (const r of ltiRoles) {
    if (typeof r !== "string") continue;
    const mapped = mapOne(r);
    if (mapped) granted.add(mapped);
  }
  const roles = ROLE_PRECEDENCE.filter((r) => granted.has(r));
  if (roles.length === 0) return { roles: ["learner"], primary: "learner" };
  return { roles, primary: roles[0]! };
}

// --- Pure claim validation (DECISION 3) ---------------------------------------

export interface ValidatedLaunch {
  sub: string;
  deploymentId: string;
  ltiRoles: string[];
  lmsRoles: StandardRole[];
  primaryRole: StandardRole;
  context?: { id: string; label?: string; title?: string };
  resourceLink: { id: string; title?: string };
  targetLinkUri?: string;
}

export type LaunchValidationReason =
  | "missing_sub"
  | "wrong_version"
  | "wrong_message_type"
  | "missing_deployment_id"
  | "unknown_deployment"
  | "nonce_mismatch"
  | "missing_resource_link";

export type LaunchResult =
  | { ok: true; launch: ValidatedLaunch }
  | { ok: false; reason: LaunchValidationReason };

export interface ValidateLaunchOpts {
  /** The nonce minted at /lti/login and burned from the launch session. */
  expectedNonce: string;
  /** Returns true if the deployment_id belongs to the registration. */
  isKnownDeployment: (deploymentId: string) => boolean;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Validate the (already signature/iss/aud/exp-verified) jose payload against the
 * LTI Resource Link structural rules and project it to a ValidatedLaunch.
 * Never throws — returns a discriminated result.
 */
export function validateLaunchClaims(
  payload: Record<string, unknown>,
  opts: ValidateLaunchOpts,
): LaunchResult {
  const sub = asString(payload.sub);
  if (!sub) return { ok: false, reason: "missing_sub" };

  // Nonce is single-use: it must match the value we minted at /lti/login.
  if (asString(payload.nonce) !== opts.expectedNonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  if (payload[CLAIM.version] !== LTI_VERSION) {
    return { ok: false, reason: "wrong_version" };
  }
  if (payload[CLAIM.messageType] !== MSG_TYPE_RESOURCE_LINK) {
    return { ok: false, reason: "wrong_message_type" };
  }

  const deploymentId = asString(payload[CLAIM.deploymentId]);
  if (!deploymentId) return { ok: false, reason: "missing_deployment_id" };
  if (!opts.isKnownDeployment(deploymentId)) {
    return { ok: false, reason: "unknown_deployment" };
  }

  const rl = payload[CLAIM.resourceLink];
  const resourceLinkId =
    rl && typeof rl === "object"
      ? asString((rl as Record<string, unknown>).id)
      : undefined;
  if (!resourceLinkId) return { ok: false, reason: "missing_resource_link" };
  const resourceLinkTitle =
    rl && typeof rl === "object"
      ? asString((rl as Record<string, unknown>).title)
      : undefined;

  const rawRoles = payload[CLAIM.roles];
  const ltiRoles = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === "string")
    : [];
  const { roles: lmsRoles, primary } = mapLtiRoles(ltiRoles);

  const ctxClaim = payload[CLAIM.context];
  const context =
    ctxClaim && typeof ctxClaim === "object"
      ? (() => {
          const c = ctxClaim as Record<string, unknown>;
          const id = asString(c.id);
          if (!id) return undefined;
          const label = asString(c.label);
          const title = asString(c.title);
          return {
            id,
            ...(label ? { label } : {}),
            ...(title ? { title } : {}),
          };
        })()
      : undefined;

  const targetLinkUri = asString(payload[CLAIM.targetLinkUri]);

  return {
    ok: true,
    launch: {
      sub,
      deploymentId,
      ltiRoles,
      lmsRoles,
      primaryRole: primary,
      ...(context ? { context } : {}),
      resourceLink: {
        id: resourceLinkId,
        ...(resourceLinkTitle ? { title: resourceLinkTitle } : {}),
      },
      ...(targetLinkUri ? { targetLinkUri } : {}),
    },
  };
}
