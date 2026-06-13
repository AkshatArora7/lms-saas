import { cookies } from "next/headers";

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

/** Roles permitted to use the admin console. */
export const ADMIN_ROLES = ["org_admin", "super_admin"];

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
  return session.roles.some((r) => ADMIN_ROLES.includes(r));
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
