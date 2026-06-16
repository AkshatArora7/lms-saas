import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  AssignRoleInput,
  AssignRoleResult,
  CreateOrgUnitResult,
  CreateUserResult,
  MembershipRecord,
  NewOrgUnitInput,
  NewUserInput,
  OrgUnitFilter,
  OrgUnitRecord,
  UpdateOrgUnitInput,
  UpdateUserInput,
  UserFilter,
  UserOrgStore,
  UserProfile,
  UserRecord,
} from "./store.js";

/** The demo tenant the local dev seed and the web/admin BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** Roles a tenant is assumed to have; mirrors the seeded per-tenant role set. */
export const KNOWN_ROLES: readonly string[] = [
  "learner",
  "instructor",
  "teaching_assistant",
  "course_builder",
  "observer",
  "org_admin",
];

interface StoredAssignment extends MembershipRecord {
  tenantId: string;
  userId: string;
}

/**
 * In-memory UserOrgStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `USER_ORG_STORE=memory`. Role validity is checked against
 * KNOWN_ROLES (the Prisma store checks the per-tenant `role` table instead).
 */
export class MemoryUserOrgStore implements UserOrgStore {
  private orgUnits: OrgUnitRecord[] = [];
  private users: UserRecord[] = [];
  private assignments: StoredAssignment[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
    private readonly knownRoles: readonly string[] = KNOWN_ROLES,
  ) {}

  seedOrgUnit(orgUnit: OrgUnitRecord): void {
    this.orgUnits.push(orgUnit);
  }

  seedUser(user: UserRecord): void {
    this.users.push(user);
  }

  // --- Org-unit tree -------------------------------------------------------
  async createOrgUnit(
    ctx: TenantContext,
    input: NewOrgUnitInput,
  ): Promise<CreateOrgUnitResult> {
    let path: string[] = [];
    if (input.parentId) {
      const parent = this.orgUnits.find(
        (o) => o.id === input.parentId && o.tenantId === ctx.tenantId,
      );
      if (!parent) return { ok: false, reason: "unknown_parent" };
      path = [...parent.path, parent.id];
    }
    const orgUnit: OrgUnitRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      type: input.type,
      parentId: input.parentId ?? null,
      name: input.name,
      code: input.code ?? null,
      path,
      isActive: true,
      createdAt: this.now().toISOString(),
    };
    this.orgUnits.push(orgUnit);
    return { ok: true, orgUnit };
  }

  async getOrgUnit(
    ctx: TenantContext,
    id: string,
  ): Promise<OrgUnitRecord | null> {
    return (
      this.orgUnits.find((o) => o.id === id && o.tenantId === ctx.tenantId) ??
      null
    );
  }

  async listOrgUnits(
    ctx: TenantContext,
    filter: OrgUnitFilter = {},
  ): Promise<OrgUnitRecord[]> {
    return this.orgUnits.filter(
      (o) =>
        o.tenantId === ctx.tenantId &&
        (filter.parentId === undefined || o.parentId === filter.parentId) &&
        (filter.type === undefined || o.type === filter.type),
    );
  }

  async getSubtree(
    ctx: TenantContext,
    id: string,
  ): Promise<OrgUnitRecord[]> {
    return this.orgUnits.filter(
      (o) => o.tenantId === ctx.tenantId && o.path.includes(id),
    );
  }

  async getAncestors(
    ctx: TenantContext,
    id: string,
  ): Promise<OrgUnitRecord[]> {
    const self = this.orgUnits.find(
      (o) => o.id === id && o.tenantId === ctx.tenantId,
    );
    if (!self) return [];
    return self.path
      .map((pid) =>
        this.orgUnits.find(
          (o) => o.id === pid && o.tenantId === ctx.tenantId,
        ),
      )
      .filter((o): o is OrgUnitRecord => o !== undefined);
  }

  async updateOrgUnit(
    ctx: TenantContext,
    id: string,
    input: UpdateOrgUnitInput,
  ): Promise<OrgUnitRecord | null> {
    const orgUnit = this.orgUnits.find(
      (o) => o.id === id && o.tenantId === ctx.tenantId,
    );
    if (!orgUnit) return null;
    if (input.name !== undefined) orgUnit.name = input.name;
    if (input.code !== undefined) orgUnit.code = input.code;
    if (input.isActive !== undefined) orgUnit.isActive = input.isActive;
    return orgUnit;
  }

  // --- Users & roles -------------------------------------------------------
  async createUser(
    ctx: TenantContext,
    input: NewUserInput,
  ): Promise<CreateUserResult> {
    const taken = this.users.some(
      (u) =>
        u.tenantId === ctx.tenantId &&
        u.email.toLowerCase() === input.email.toLowerCase(),
    );
    if (taken) return { ok: false, reason: "email_taken" };
    const user: UserRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      email: input.email,
      displayName: input.displayName,
      status: input.status ?? "invited",
      locale: input.locale ?? "en",
      createdAt: this.now().toISOString(),
    };
    this.users.push(user);
    return { ok: true, user };
  }

  async getUser(
    ctx: TenantContext,
    id: string,
  ): Promise<UserProfile | null> {
    const user = this.users.find(
      (u) => u.id === id && u.tenantId === ctx.tenantId,
    );
    if (!user) return null;
    const memberships = this.assignments
      .filter((a) => a.tenantId === ctx.tenantId && a.userId === id)
      .map(({ tenantId: _t, userId: _u, ...m }) => m);
    return { ...user, memberships };
  }

  async listUsers(
    ctx: TenantContext,
    filter: UserFilter = {},
  ): Promise<UserRecord[]> {
    return this.users.filter((u) => {
      if (u.tenantId !== ctx.tenantId) return false;
      if (filter.status !== undefined && u.status !== filter.status) {
        return false;
      }
      if (filter.orgUnitId !== undefined) {
        return this.assignments.some(
          (a) =>
            a.tenantId === ctx.tenantId &&
            a.userId === u.id &&
            a.orgUnitId === filter.orgUnitId,
        );
      }
      return true;
    });
  }

  async updateUser(
    ctx: TenantContext,
    id: string,
    input: UpdateUserInput,
  ): Promise<UserRecord | null> {
    const user = this.users.find(
      (u) => u.id === id && u.tenantId === ctx.tenantId,
    );
    if (!user) return null;
    if (input.displayName !== undefined) user.displayName = input.displayName;
    if (input.status !== undefined) user.status = input.status;
    if (input.locale !== undefined) user.locale = input.locale;
    return user;
  }

  async assignRole(
    ctx: TenantContext,
    userId: string,
    input: AssignRoleInput,
  ): Promise<AssignRoleResult> {
    const user = this.users.find(
      (u) => u.id === userId && u.tenantId === ctx.tenantId,
    );
    if (!user) return { ok: false, reason: "user_not_found" };
    const orgUnit = this.orgUnits.find(
      (o) => o.id === input.orgUnitId && o.tenantId === ctx.tenantId,
    );
    if (!orgUnit) return { ok: false, reason: "unknown_org_unit" };
    if (!this.knownRoles.includes(input.role)) {
      return { ok: false, reason: "unknown_role" };
    }
    const existing = this.assignments.find(
      (a) =>
        a.tenantId === ctx.tenantId &&
        a.userId === userId &&
        a.roleName === input.role &&
        a.orgUnitId === input.orgUnitId,
    );
    if (existing) {
      existing.cascade = input.cascade ?? true;
      const { tenantId: _t, userId: _u, ...m } = existing;
      return { ok: true, membership: m };
    }
    const stored: StoredAssignment = {
      assignmentId: this.generateId(),
      roleId: `role-${input.role}`,
      roleName: input.role,
      orgUnitId: input.orgUnitId,
      cascade: input.cascade ?? true,
      tenantId: ctx.tenantId,
      userId,
    };
    this.assignments.push(stored);
    const { tenantId: _t, userId: _u, ...m } = stored;
    return { ok: true, membership: m };
  }

  async revokeRole(
    ctx: TenantContext,
    userId: string,
    assignmentId: string,
  ): Promise<boolean> {
    const idx = this.assignments.findIndex(
      (a) =>
        a.tenantId === ctx.tenantId &&
        a.userId === userId &&
        a.assignmentId === assignmentId,
    );
    if (idx === -1) return false;
    this.assignments.splice(idx, 1);
    return true;
  }
}

/** Build a MemoryUserOrgStore pre-seeded with a small demo org tree + users. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryUserOrgStore {
  const store = new MemoryUserOrgStore(generateId, now);
  const createdAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
  store.seedOrgUnit({
    id: "demo-org",
    tenantId: DEMO_TENANT_ID,
    type: "organization",
    parentId: null,
    name: "Northwind School District",
    code: "NWSD",
    path: [],
    isActive: true,
    createdAt,
  });
  store.seedOrgUnit({
    id: "demo-dept",
    tenantId: DEMO_TENANT_ID,
    type: "department",
    parentId: "demo-org",
    name: "Mathematics",
    code: "MATH",
    path: ["demo-org"],
    isActive: true,
    createdAt,
  });
  store.seedUser({
    id: "demo-admin",
    tenantId: DEMO_TENANT_ID,
    email: "admin@demo.school",
    displayName: "Amelia Stone",
    status: "active",
    locale: "en",
    createdAt,
  });
  return store;
}
