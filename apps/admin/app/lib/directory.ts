import { TENANT_ID } from "./auth";
import {
  getUser,
  listOrgUnits,
  listUsers,
  type UserStatus,
} from "./user-org-api";

/**
 * Directory presentation layer for the admin console.
 *
 * Resolves people from the user-org microservice (tenant-scoped, via the BFF
 * client in `user-org-api.ts`) and shapes them for the directory screens. The
 * list payload now arrives already enriched with each user's org-unit role
 * `memberships`, so we read those directly and only resolve org-unit display
 * names via a single `listOrgUnits` lookup. Returns `null`/`offline` on a
 * service failure so the pages render a graceful offline state — there is no
 * demo fallback.
 */

export type { UserStatus };

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: UserStatus;
  /** The org unit the user is primarily assigned to (first membership). */
  orgUnit: string;
}

export interface DirectorySummary {
  total: number;
  admins: number;
  pendingInvites: number;
}

export interface DirectoryUserDetail {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  locale: string | null;
  roles: string[];
  orgUnits: string[];
}

export interface DirectoryResult {
  users: DirectoryUser[];
  summary: DirectorySummary;
}

export type DirectoryUserResult =
  | { status: "ok"; user: DirectoryUserDetail }
  | { status: "not_found" }
  | { status: "offline" };

const ADMIN_ROLE_NAMES = ["org_admin", "super_admin"];
const NO_UNIT = "—";

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Resolve the admin directory for a tenant. Returns `null` when the service is
 * unreachable so the page can render an offline state instead of demo data.
 */
export async function getDirectory(
  tenantId: string = TENANT_ID,
): Promise<DirectoryResult | null> {
  const list = await listUsers(tenantId);
  if (!list.ok) return null;

  const unitsRes = await listOrgUnits(tenantId);
  const unitName = new Map(
    unitsRes.ok ? unitsRes.orgUnits.map((u) => [u.id, u.name] as const) : [],
  );

  const users: DirectoryUser[] = list.users.map((record) => {
    const memberships = record.memberships;
    const roles = uniq(memberships.map((m) => m.roleName));
    const orgUnit =
      memberships.length > 0
        ? unitName.get(memberships[0]!.orgUnitId) ?? NO_UNIT
        : NO_UNIT;
    return {
      id: record.id,
      name: record.displayName,
      email: record.email,
      roles,
      status: record.status,
      orgUnit,
    };
  });

  const summary: DirectorySummary = {
    total: users.length,
    admins: users.filter((u) =>
      u.roles.some((r) => ADMIN_ROLE_NAMES.includes(r)),
    ).length,
    pendingInvites: users.filter((u) => u.status === "invited").length,
  };

  return { users, summary };
}

/**
 * Resolve a single user's profile, distinguishing a genuine 404 from an offline
 * service so the detail page can render the right state.
 */
export async function getDirectoryUserDetail(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<DirectoryUserResult> {
  const detail = await getUser(userId, tenantId);
  if (!detail.ok) {
    return detail.notFound ? { status: "not_found" } : { status: "offline" };
  }

  const unitsRes = await listOrgUnits(tenantId);
  const unitName = new Map(
    unitsRes.ok ? unitsRes.orgUnits.map((u) => [u.id, u.name] as const) : [],
  );

  const { user } = detail;
  return {
    status: "ok",
    user: {
      id: user.id,
      name: user.displayName,
      email: user.email,
      status: user.status,
      locale: user.locale ?? null,
      roles: uniq(user.memberships.map((m) => m.roleName)),
      orgUnits: uniq(
        user.memberships.map((m) => unitName.get(m.orgUnitId) ?? NO_UNIT),
      ),
    },
  };
}
