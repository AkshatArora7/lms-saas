import { TENANT_ID } from "./auth";

/**
 * Server-only client for the user-org microservice.
 *
 * BFF read boundary for a user's profile record (display name, email, locale)
 * and org-unit memberships. Forwards the authenticated tenant as `x-tenant-id`;
 * reads return `null` on failure so the caller can fall back to session-derived
 * fields rather than crashing.
 */

export const USER_ORG_SERVICE_URL =
  process.env.USER_ORG_SERVICE_URL ?? "http://localhost:4003";

export interface Membership {
  assignmentId: string;
  roleId: string;
  roleName: string;
  orgUnitId: string;
  cascade: boolean;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  status: string;
  locale: string | null;
  createdAt: string;
  memberships: Membership[];
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/** Fetch a user's profile by id. Returns `null` when missing or unreachable. */
export async function getUser(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<User | null> {
  try {
    const res = await fetch(
      `${USER_ORG_SERVICE_URL}/users/${encodeURIComponent(id)}`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { user: User };
    return data.user ?? null;
  } catch {
    return null;
  }
}
