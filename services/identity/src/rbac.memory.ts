import { randomUUID } from "node:crypto";

import { EVENT_TYPES } from "@lms/events";
import type { TenantContext } from "@lms/types";

import type {
  CreateRoleResult,
  DeleteRoleResult,
  PermissionRecord,
  RbacStore,
  RenameRoleResult,
  RoleDetail,
  RoleRecord,
  SetPermissionsResult,
} from "./rbac.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** A small default permission catalog (the Postgres `permission` table seed). */
export const DEFAULT_PERMISSIONS: PermissionRecord[] = [
  { key: "courses:manage", description: "Create and edit courses." },
  { key: "users:manage", description: "Invite and manage users." },
  { key: "grades:manage", description: "Enter and release grades." },
  { key: "discussions:posts:manage", description: "Moderate discussion posts." },
  { key: "reports:view", description: "View analytics and reports." },
];

interface StoredRole extends RoleRecord {
  permissions: Set<string>;
}

interface EmittedEvent {
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * In-memory RbacStore. Roles/mappings are filtered by tenant to emulate RLS.
 * Emitted events are recorded so tests can assert that changes are audited.
 */
export class MemoryRbacStore implements RbacStore {
  private roles: StoredRole[] = [];
  private readonly events: EmittedEvent[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly permissions: PermissionRecord[] = DEFAULT_PERMISSIONS,
  ) {}

  /** Seed a role (e.g. a system role) for tests. */
  seedRole(role: RoleRecord, permissions: string[] = []): void {
    this.roles.push({ ...role, permissions: new Set(permissions) });
  }

  /** Events emitted by RBAC mutations (for audit assertions). */
  emittedEvents(): EmittedEvent[] {
    return this.events;
  }

  private emit(
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    this.events.push({ tenantId, type, payload });
  }

  private find(ctx: TenantContext, id: string): StoredRole | undefined {
    return this.roles.find((r) => r.id === id && r.tenantId === ctx.tenantId);
  }

  async listPermissions(): Promise<PermissionRecord[]> {
    return this.permissions.slice();
  }

  async createRole(ctx: TenantContext, name: string): Promise<CreateRoleResult> {
    if (
      this.roles.some((r) => r.tenantId === ctx.tenantId && r.name === name)
    ) {
      return { ok: false, reason: "name_taken" };
    }
    const role: StoredRole = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      name,
      isSystem: false,
      permissions: new Set(),
    };
    this.roles.push(role);
    this.emit(ctx.tenantId, EVENT_TYPES.ROLE_CREATED, {
      roleId: role.id,
      name,
    });
    return { ok: true, role: this.toRecord(role) };
  }

  private toRecord(role: StoredRole): RoleRecord {
    return {
      id: role.id,
      tenantId: role.tenantId,
      name: role.name,
      isSystem: role.isSystem,
    };
  }

  async listRoles(ctx: TenantContext): Promise<RoleRecord[]> {
    return this.roles
      .filter((r) => r.tenantId === ctx.tenantId)
      .map((r) => this.toRecord(r));
  }

  async getRole(ctx: TenantContext, id: string): Promise<RoleDetail | null> {
    const role = this.find(ctx, id);
    if (!role) return null;
    return { ...this.toRecord(role), permissions: [...role.permissions].sort() };
  }

  async renameRole(
    ctx: TenantContext,
    id: string,
    name: string,
  ): Promise<RenameRoleResult> {
    const role = this.find(ctx, id);
    if (!role) return { ok: false, reason: "not_found" };
    if (role.isSystem) return { ok: false, reason: "system_role" };
    if (
      this.roles.some(
        (r) => r.tenantId === ctx.tenantId && r.name === name && r.id !== id,
      )
    ) {
      return { ok: false, reason: "name_taken" };
    }
    role.name = name;
    this.emit(ctx.tenantId, EVENT_TYPES.ROLE_UPDATED, { roleId: id, name });
    return { ok: true, role: this.toRecord(role) };
  }

  async deleteRole(ctx: TenantContext, id: string): Promise<DeleteRoleResult> {
    const role = this.find(ctx, id);
    if (!role) return { ok: false, reason: "not_found" };
    if (role.isSystem) return { ok: false, reason: "system_role" };
    this.roles = this.roles.filter((r) => r !== role);
    this.emit(ctx.tenantId, EVENT_TYPES.ROLE_DELETED, { roleId: id });
    return { ok: true };
  }

  async setRolePermissions(
    ctx: TenantContext,
    id: string,
    keys: string[],
  ): Promise<SetPermissionsResult> {
    const role = this.find(ctx, id);
    if (!role) return { ok: false, reason: "not_found" };
    if (role.isSystem) return { ok: false, reason: "system_role" };
    const unique = [...new Set(keys)];
    const catalog = new Set(this.permissions.map((p) => p.key));
    if (unique.some((k) => !catalog.has(k))) {
      return { ok: false, reason: "unknown_permission" };
    }
    role.permissions = new Set(unique);
    this.emit(ctx.tenantId, EVENT_TYPES.ROLE_UPDATED, {
      roleId: id,
      permissions: unique,
    });
    return {
      ok: true,
      role: { ...this.toRecord(role), permissions: unique.sort() },
    };
  }
}
