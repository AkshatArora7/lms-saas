import type { TenantContext } from "@lms/types";

/** A group within a group-assignment's group set. */
export interface GroupRecord {
  id: string;
  tenantId: string;
  assignmentId: string;
  name: string;
  createdAt: string;
}

export interface GroupDetail extends GroupRecord {
  /** User ids of the group's members. */
  members: string[];
}

export type CreateGroupResult =
  | { ok: true; group: GroupRecord }
  | { ok: false; reason: "assignment_not_found" };

export type AddMemberResult =
  | { ok: true; members: string[] }
  | { ok: false; reason: "group_not_found" | "already_in_a_group" };

/**
 * Persistence boundary for group assignments (group sets + membership). A
 * learner belongs to at most one group per assignment. Separate from the core
 * submission store; RLS-scoped via withTenant.
 */
export interface GroupStore {
  createGroup(
    ctx: TenantContext,
    assignmentId: string,
    name: string,
  ): Promise<CreateGroupResult>;

  listGroups(
    ctx: TenantContext,
    assignmentId: string,
  ): Promise<GroupDetail[]>;

  getGroup(ctx: TenantContext, id: string): Promise<GroupDetail | null>;

  deleteGroup(ctx: TenantContext, id: string): Promise<boolean>;

  /** Add a member; rejects if already in another group for the same assignment. */
  addMember(
    ctx: TenantContext,
    groupId: string,
    userId: string,
  ): Promise<AddMemberResult>;

  removeMember(
    ctx: TenantContext,
    groupId: string,
    userId: string,
  ): Promise<boolean>;

  /** The group a learner belongs to for an assignment (for group submission). */
  groupForUser(
    ctx: TenantContext,
    assignmentId: string,
    userId: string,
  ): Promise<GroupRecord | null>;
}
