import { cookies } from "next/headers";
import type { StandardRole } from "@lms/types";

/**
 * Server-only auth helpers for the admin console. Mirrors the learner app's BFF
 * pattern but uses distinct cookie names so the two surfaces can run side by
 * side on localhost without clobbering each other's session.
 */

export const IDENTITY_URL =
  process.env.IDENTITY_URL ?? "http://localhost:4001";

export const TENANT_ID =
  process.env.DEMO_TENANT_ID ?? "11111111-1111-1111-1111-111111111111";

export const ACCESS_COOKIE = "lms_admin_at";
export const REFRESH_COOKIE = "lms_admin_rt";
/** Holds the signed OIDC state between the SSO redirect and the callback. */
export const SSO_STATE_COOKIE = "lms_admin_sso_state";

/**
 * The identity provider to federate against for this surface. In production
 * this is resolved per tenant; for local dev we pin the seeded demo provider.
 */
export const SSO_PROVIDER_ID =
  process.env.SSO_PROVIDER_ID ?? "22222222-2222-2222-2222-222222222222";

/**
 * Roles permitted to use the admin console, typed against the stable
 * {@link StandardRole} key union from `@lms/types` (mirrors the analytics authz
 * convention in `services/analytics/src/store.ts`). Typing the privileged
 * constant — not the wire `Session.roles` — keeps the admin set stable and
 * compile-checked without changing who is an admin. Runtime membership stays
 * exactly `{org_admin, super_admin}`.
 */
export const SUPER_ADMIN_ROLE: StandardRole = "super_admin";
export const ORG_ADMIN_ROLE: StandardRole = "org_admin";
export const ADMIN_ROLES: readonly StandardRole[] = [
  SUPER_ADMIN_ROLE,
  ORG_ADMIN_ROLE,
];

export const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export interface Session {
  userId: string;
  tenantId: string;
  tier: string;
  roles: string[];
  scopes: string[];
}

export function isAdmin(session: Session): boolean {
  // Mirror the analytics authz convention (`store.ts:575-576`): test the
  // wire-shape `string[]` against the typed privileged constants. `string[]`
  // `.includes()` accepts a `StandardRole` arg (assignable to `string`), which
  // typechecks where `ADMIN_ROLES.includes(r: string)` would not. Runtime is
  // identical — membership stays exactly `{org_admin, super_admin}`.
  return ADMIN_ROLES.some((role) => session.roles.includes(role));
}

/**
 * Resolve the current session by introspecting the access-token cookie against
 * the identity service. Returns null when there is no valid session.
 */
export async function getSession(): Promise<Session | null> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  try {
    const res = await fetch(`${IDENTITY_URL}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Session;
  } catch {
    return null;
  }
}
