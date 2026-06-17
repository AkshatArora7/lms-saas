import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  AddMemberResult,
  CreateGroupResult,
  GroupDetail,
  GroupRecord,
  GroupStore,
} from "./groups.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface StoredGroup extends GroupRecord {
  members: string[];
}

/**
 * In-memory group store. Tenant-filtered (RLS emulation); assignments are
 * seeded so group creation can validate. Enforces one group per user per
 * assignment.
 */
export class MemoryGroupStore implements GroupStore {
  private groups: StoredGroup[] = [];
  private assignments: { tenantId: string; assignmentId: string }[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {}

  seedAssignment(tenantId: string, assignmentId: string): void {
    this.assignments.push({ tenantId, assignmentId });
  }

  private hasAssignment(ctx: TenantContext, assignmentId: string): boolean {
    return this.assignments.some(
      (a) => a.tenantId === ctx.tenantId && a.assignmentId === assignmentId,
    );
  }
  private toDetail(g: StoredGroup): GroupDetail {
    return {
      id: g.id,
      tenantId: g.tenantId,
      assignmentId: g.assignmentId,
      name: g.name,
      createdAt: g.createdAt,
      members: [...g.members],
    };
  }

  async createGroup(
    ctx: TenantContext,
    assignmentId: string,
    name: string,
  ): Promise<CreateGroupResult> {
    if (!this.hasAssignment(ctx, assignmentId)) {
      return { ok: false, reason: "assignment_not_found" };
    }
    const group: StoredGroup = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      assignmentId,
      name,
      createdAt: new Date(0).toISOString(),
      members: [],
    };
    this.groups.push(group);
    const { members: _m, ...rec } = group;
    return { ok: true, group: rec };
  }

  async listGroups(
    ctx: TenantContext,
    assignmentId: string,
  ): Promise<GroupDetail[]> {
    return this.groups
      .filter((g) => g.tenantId === ctx.tenantId && g.assignmentId === assignmentId)
      .map((g) => this.toDetail(g));
  }

  async getGroup(ctx: TenantContext, id: string): Promise<GroupDetail | null> {
    const g = this.groups.find((x) => x.id === id && x.tenantId === ctx.tenantId);
    return g ? this.toDetail(g) : null;
  }

  async deleteGroup(ctx: TenantContext, id: string): Promise<boolean> {
    const before = this.groups.length;
    this.groups = this.groups.filter(
      (g) => !(g.id === id && g.tenantId === ctx.tenantId),
    );
    return this.groups.length < before;
  }

  async addMember(
    ctx: TenantContext,
    groupId: string,
    userId: string,
  ): Promise<AddMemberResult> {
    const group = this.groups.find(
      (g) => g.id === groupId && g.tenantId === ctx.tenantId,
    );
    if (!group) return { ok: false, reason: "group_not_found" };
    const inSibling = this.groups.some(
      (g) =>
        g.tenantId === ctx.tenantId &&
        g.assignmentId === group.assignmentId &&
        g.id !== groupId &&
        g.members.includes(userId),
    );
    if (inSibling) return { ok: false, reason: "already_in_a_group" };
    if (!group.members.includes(userId)) group.members.push(userId);
    return { ok: true, members: [...group.members] };
  }

  async removeMember(
    ctx: TenantContext,
    groupId: string,
    userId: string,
  ): Promise<boolean> {
    const group = this.groups.find(
      (g) => g.id === groupId && g.tenantId === ctx.tenantId,
    );
    if (!group) return false;
    const before = group.members.length;
    group.members = group.members.filter((u) => u !== userId);
    return group.members.length < before;
  }

  async groupForUser(
    ctx: TenantContext,
    assignmentId: string,
    userId: string,
  ): Promise<GroupRecord | null> {
    const g = this.groups.find(
      (x) =>
        x.tenantId === ctx.tenantId &&
        x.assignmentId === assignmentId &&
        x.members.includes(userId),
    );
    if (!g) return null;
    const { members: _m, ...rec } = g;
    return rec;
  }
}
