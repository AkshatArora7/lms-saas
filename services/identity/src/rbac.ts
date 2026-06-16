import type { TenantContext } from "@lms/types";

/**
 * RBAC management surface: custom roles built from a permission catalog, with
 * `role_permission` mappings. System roles (is_system) are read-only; custom
 * roles are editable. Mutations emit an outbox event so changes are auditable
 * (the audit service mirrors the event stream).
 *
 * Kept separate from the auth `IdentityStore` so the login/token path stays
 * untouched; both share the gateway-resolved tenant context.
 */

export interface PermissionRecord {
  key: string;
  description: string | null;
}

export interface RoleRecord {
  id: string;
  tenantId: string;
  name: string;
  isSystem: boolean;
}

export interface RoleDetail extends RoleRecord {
  /** Permission keys granted to the role. */
  permissions: string[];
}

export type CreateRoleResult =
  | { ok: true; role: RoleRecord }
  | { ok: false; reason: "name_taken" };

export type RenameRoleResult =
  | { ok: true; role: RoleRecord }
  | { ok: false; reason: "not_found" | "system_role" | "name_taken" };

export type DeleteRoleResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "system_role" };

export type SetPermissionsResult =
  | { ok: true; role: RoleDetail }
  | { ok: false; reason: "not_found" | "system_role" | "unknown_permission" };

/**
 * Persistence boundary for RBAC management. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one.
 */
export interface RbacStore {
  /** The global permission catalog (what roles can be built from). */
  listPermissions(ctx: TenantContext): Promise<PermissionRecord[]>;

  createRole(ctx: TenantContext, name: string): Promise<CreateRoleResult>;

  listRoles(ctx: TenantContext): Promise<RoleRecord[]>;

  getRole(ctx: TenantContext, id: string): Promise<RoleDetail | null>;

  renameRole(
    ctx: TenantContext,
    id: string,
    name: string,
  ): Promise<RenameRoleResult>;

  deleteRole(ctx: TenantContext, id: string): Promise<DeleteRoleResult>;

  /** Replace a role's permission set (validated against the catalog). */
  setRolePermissions(
    ctx: TenantContext,
    id: string,
    permissionKeys: string[],
  ): Promise<SetPermissionsResult>;
}
