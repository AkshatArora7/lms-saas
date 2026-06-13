import { cookies } from "next/headers";

/**
 * Server-only auth helpers for the learner web app. The browser never sees the
 * identity service or the raw tokens: this app talks to the identity service
 * from its own server (a thin BFF), and tokens live in httpOnly cookies.
 */

export const IDENTITY_URL =
  process.env.IDENTITY_URL ?? "http://localhost:4001";

/**
 * The tenant this surface serves. In production the gateway resolves the tenant
 * from the host/subdomain; for local dev we pin the seeded demo tenant.
 */
export const TENANT_ID =
  process.env.DEMO_TENANT_ID ?? "11111111-1111-1111-1111-111111111111";

export const ACCESS_COOKIE = "lms_at";
export const REFRESH_COOKIE = "lms_rt";
/** Holds the signed OIDC state between the SSO redirect and the callback. */
export const SSO_STATE_COOKIE = "lms_sso_state";

/**
 * The identity provider to federate against for this surface. In production
 * this is resolved per tenant; for local dev we pin the seeded demo provider.
 */
export const SSO_PROVIDER_ID =
  process.env.SSO_PROVIDER_ID ?? "22222222-2222-2222-2222-222222222222";

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
