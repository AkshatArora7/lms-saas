import type { TenantContext } from "@lms/types";

/** Org-unit kinds, mirroring the schema CHECK and OneRoster org types. */
export type OrgUnitType =
  | "organization"
  | "department"
  | "semester"
  | "course_template"
  | "course_offering"
  | "section"
  | "group";

export const ORG_UNIT_TYPES: readonly OrgUnitType[] = [
  "organization",
  "department",
  "semester",
  "course_template",
  "course_offering",
  "section",
  "group",
];

/** A node in the org-unit hierarchy (district → … → section/group). */
export interface OrgUnitRecord {
  id: string;
  tenantId: string;
  type: OrgUnitType;
  parentId: string | null;
  name: string;
  code: string | null;
  /** Materialised path of ancestor ids (root-first), excluding self. */
  path: string[];
  isActive: boolean;
  createdAt: string;
}

export interface NewOrgUnitInput {
  type: OrgUnitType;
  /** Parent org unit; null/omitted creates a root (e.g. an organization). */
  parentId?: string | null;
  name: string;
  code?: string | null;
}

export type CreateOrgUnitResult =
  | { ok: true; orgUnit: OrgUnitRecord }
  | { ok: false; reason: "unknown_parent" };

export interface UpdateOrgUnitInput {
  name?: string;
  code?: string | null;
  isActive?: boolean;
}

export interface OrgUnitFilter {
  parentId?: string;
  type?: OrgUnitType;
}

export type UserStatus = "invited" | "active" | "inactive";

/** A user profile within a tenant. */
export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  status: UserStatus;
  locale: string;
  createdAt: string;
}

/** A role granted to a user at an org unit. */
export interface MembershipRecord {
  assignmentId: string;
  roleId: string;
  roleName: string;
  orgUnitId: string;
  cascade: boolean;
}

/** A user with their org-unit role memberships. */
export interface UserProfile extends UserRecord {
  memberships: MembershipRecord[];
}

/** A membership tagged with the user it belongs to, for batched grouping. */
export type UserMembership = MembershipRecord & { userId: string };

/**
 * Pure helper: attach each user's memberships from a flat, batched list of
 * `(userId, membership)` rows. Used by both stores so memory and Postgres agree
 * on the enriched `listUsers` shape, and unit-testable without a DB. Users with
 * no assignments get `memberships: []`. Input order of `users` is preserved.
 */
export function groupMembershipsByUser(
  users: UserRecord[],
  memberships: UserMembership[],
): UserProfile[] {
  const byUser = new Map<string, MembershipRecord[]>();
  for (const { userId, ...membership } of memberships) {
    const list = byUser.get(userId);
    if (list) list.push(membership);
    else byUser.set(userId, [membership]);
  }
  return users.map((user) => ({
    ...user,
    memberships: byUser.get(user.id) ?? [],
  }));
}

export interface NewUserInput {
  email: string;
  displayName: string;
  status?: UserStatus;
  locale?: string;
}

export type CreateUserResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: "email_taken" };

export interface UpdateUserInput {
  displayName?: string;
  status?: UserStatus;
  locale?: string;
}

export interface UserFilter {
  status?: UserStatus;
  /** Restrict to users with a role assignment at this org unit. */
  orgUnitId?: string;
}

export interface AssignRoleInput {
  /** Per-tenant role name, resolved to role_id against the `role` table. */
  role: string;
  orgUnitId: string;
  cascade?: boolean;
}

export type AssignRoleResult =
  | { ok: true; membership: MembershipRecord }
  | { ok: false; reason: "unknown_role" | "user_not_found" | "unknown_org_unit" };

/**
 * Persistence boundary for the user-org service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the enrollment/course/attendance
 * services.
 */
export interface UserOrgStore {
  // --- Org-unit tree (story #22) ---
  createOrgUnit(
    ctx: TenantContext,
    input: NewOrgUnitInput,
  ): Promise<CreateOrgUnitResult>;

  getOrgUnit(ctx: TenantContext, id: string): Promise<OrgUnitRecord | null>;

  listOrgUnits(
    ctx: TenantContext,
    filter?: OrgUnitFilter,
  ): Promise<OrgUnitRecord[]>;

  /** All descendants of an org unit (excludes the node itself), via path. */
  getSubtree(ctx: TenantContext, id: string): Promise<OrgUnitRecord[]>;

  /** Ancestors of an org unit, root-first (excludes the node itself). */
  getAncestors(ctx: TenantContext, id: string): Promise<OrgUnitRecord[]>;

  updateOrgUnit(
    ctx: TenantContext,
    id: string,
    input: UpdateOrgUnitInput,
  ): Promise<OrgUnitRecord | null>;

  // --- Users & roles (story #23) ---
  createUser(
    ctx: TenantContext,
    input: NewUserInput,
  ): Promise<CreateUserResult>;

  getUser(ctx: TenantContext, id: string): Promise<UserProfile | null>;

  listUsers(ctx: TenantContext, filter?: UserFilter): Promise<UserProfile[]>;

  updateUser(
    ctx: TenantContext,
    id: string,
    input: UpdateUserInput,
  ): Promise<UserRecord | null>;

  assignRole(
    ctx: TenantContext,
    userId: string,
    input: AssignRoleInput,
  ): Promise<AssignRoleResult>;

  /** Revoke a role assignment from a user; true when a row was removed. */
  revokeRole(
    ctx: TenantContext,
    userId: string,
    assignmentId: string,
  ): Promise<boolean>;
}
