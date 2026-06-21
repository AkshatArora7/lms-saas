import { TENANT_ID } from "./auth";

/**
 * Server-only client for the user-org microservice.
 *
 * BFF read boundary for the admin console's directory and org-unit screens:
 * every call forwards the authenticated tenant as `x-tenant-id` (the trusted
 * header the gateway injects in production and the user-org resolver expects),
 * so all people/structure data stays tenant-scoped. Reads return discriminated
 * results instead of throwing, so a server component can render a graceful
 * offline state when the service is unreachable rather than crashing the render.
 */

export const USER_ORG_SERVICE_URL =
  process.env.USER_ORG_SERVICE_URL ?? "http://localhost:4003";

export type UserStatus = "invited" | "active" | "inactive";

/** A role granted to a user at an org unit. */
export interface Membership {
  assignmentId: string;
  roleId: string;
  roleName: string;
  orgUnitId: string;
  cascade: boolean;
}

/** A user profile within a tenant (list shape — no memberships). */
export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  status: UserStatus;
  locale: string;
  createdAt: string;
}

/** A user with their org-unit role memberships (detail shape). */
export interface UserProfile extends UserRecord {
  memberships: Membership[];
}

export type OrgUnitType =
  | "organization"
  | "department"
  | "semester"
  | "course_template"
  | "course_offering"
  | "section"
  | "group";

/** A node in the org-unit hierarchy (flat — `parentId` links the tree). */
export interface OrgUnitRecord {
  id: string;
  tenantId: string;
  type: OrgUnitType;
  parentId: string | null;
  name: string;
  code: string | null;
  path: string[];
  isActive: boolean;
  createdAt: string;
}

export type UsersResult =
  | { ok: true; users: UserProfile[] }
  | { ok: false; error: string };

export type UserResult =
  | { ok: true; user: UserProfile }
  | { ok: false; notFound: boolean; error: string };

export type OrgUnitsResult =
  | { ok: true; orgUnits: OrgUnitRecord[] }
  | { ok: false; error: string };

const OFFLINE = "The user & org service is unreachable.";

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/**
 * List every user for the tenant (backend ordering preserved). The list payload
 * is enriched per user with org-unit role `memberships` (same `UserProfile`
 * shape as the detail endpoint), so callers no longer fan out a per-user fetch.
 */
export async function listUsers(
  tenantId: string = TENANT_ID,
): Promise<UsersResult> {
  try {
    const res = await fetch(`${USER_ORG_SERVICE_URL}/users`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: "Failed to load users." };
    const data = (await res.json()) as { users: UserProfile[] };
    return { ok: true, users: data.users };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

/** Fetch a single user's profile (with memberships), or an error result. */
export async function getUser(
  id: string,
  tenantId: string = TENANT_ID,
): Promise<UserResult> {
  try {
    const res = await fetch(
      `${USER_ORG_SERVICE_URL}/users/${encodeURIComponent(id)}`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (res.status === 404) {
      return { ok: false, notFound: true, error: "User not found." };
    }
    if (!res.ok) {
      return { ok: false, notFound: false, error: "Failed to load user." };
    }
    const data = (await res.json()) as { user: UserProfile };
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, notFound: false, error: OFFLINE };
  }
}

/**
 * List every org unit for the tenant. The endpoint returns the full flat set
 * (each row carries `parentId`/`path`), so callers build the tree client-side
 * without needing per-node subtree calls.
 */
export async function listOrgUnits(
  tenantId: string = TENANT_ID,
): Promise<OrgUnitsResult> {
  try {
    const res = await fetch(`${USER_ORG_SERVICE_URL}/org-units`, {
      headers: tenantHeader(tenantId),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: "Failed to load org units." };
    const data = (await res.json()) as { orgUnits: OrgUnitRecord[] };
    return { ok: true, orgUnits: data.orgUnits };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}
