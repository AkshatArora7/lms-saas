import { withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

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

interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  is_system: boolean;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function toRole(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    isSystem: row.is_system,
  };
}

async function permissionsFor(db: Db, roleId: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ permission_key: string }[]>(
    `SELECT permission_key FROM role_permission WHERE role_id = $1::uuid
      ORDER BY permission_key`,
    roleId,
  );
  return rows.map((r) => r.permission_key);
}

/** Emit an auditable RBAC event into the transactional outbox (same tx). */
async function emit(
  db: Db,
  tenantId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO event_outbox (tenant_id, type, payload)
     VALUES ($1::uuid, $2, $3::jsonb)`,
    tenantId,
    type,
    JSON.stringify(payload),
  );
}

/**
 * Postgres-backed RBAC store. Roles and role_permission rows are RLS-scoped via
 * `withTenant`; the permission catalog is global. System roles are guarded
 * read-only. uuid params are cast `::uuid`.
 */
export function createPrismaRbacStore(): RbacStore {
  return {
    async listPermissions(ctx): Promise<PermissionRecord[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<PermissionRecord[]>(
          `SELECT key, description FROM permission ORDER BY key`,
        );
        return rows;
      });
    },

    async createRole(ctx, name): Promise<CreateRoleResult> {
      return withTenant<CreateRoleResult>(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RoleRow[]>(
          `INSERT INTO role (tenant_id, name, is_system)
           VALUES ($1::uuid, $2, false)
           ON CONFLICT (tenant_id, name) DO NOTHING
           RETURNING id, tenant_id, name, is_system`,
          ctx.tenantId,
          name,
        );
        if (rows.length === 0) return { ok: false, reason: "name_taken" };
        const role = toRole(rows[0]!);
        await emit(db, ctx.tenantId, EVENT_TYPES.ROLE_CREATED, {
          roleId: role.id,
          name: role.name,
        });
        return { ok: true, role };
      });
    },

    async listRoles(ctx): Promise<RoleRecord[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RoleRow[]>(
          `SELECT id, tenant_id, name, is_system FROM role ORDER BY name`,
        );
        return rows.map(toRole);
      });
    },

    async getRole(ctx, id): Promise<RoleDetail | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<RoleRow[]>(
          `SELECT id, tenant_id, name, is_system FROM role WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (rows.length === 0) return null;
        return { ...toRole(rows[0]!), permissions: await permissionsFor(db, id) };
      });
    },

    async renameRole(ctx, id, name): Promise<RenameRoleResult> {
      return withTenant<RenameRoleResult>(ctx, async (db: Db) => {
        const existing = await db.$queryRawUnsafe<RoleRow[]>(
          `SELECT id, tenant_id, name, is_system FROM role WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (existing.length === 0) return { ok: false, reason: "not_found" };
        if (existing[0]!.is_system) return { ok: false, reason: "system_role" };
        const updated = await db.$queryRawUnsafe<RoleRow[]>(
          `UPDATE role SET name = $1 WHERE id = $2::uuid
           AND NOT EXISTS (
             SELECT 1 FROM role r2 WHERE r2.tenant_id = role.tenant_id
               AND r2.name = $1 AND r2.id <> role.id)
           RETURNING id, tenant_id, name, is_system`,
          name,
          id,
        );
        if (updated.length === 0) return { ok: false, reason: "name_taken" };
        const role = toRole(updated[0]!);
        await emit(db, ctx.tenantId, EVENT_TYPES.ROLE_UPDATED, {
          roleId: role.id,
          name: role.name,
        });
        return { ok: true, role };
      });
    },

    async deleteRole(ctx, id): Promise<DeleteRoleResult> {
      return withTenant<DeleteRoleResult>(ctx, async (db: Db) => {
        const existing = await db.$queryRawUnsafe<RoleRow[]>(
          `SELECT id, is_system FROM role WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (existing.length === 0) return { ok: false, reason: "not_found" };
        if (existing[0]!.is_system) return { ok: false, reason: "system_role" };
        await db.$executeRawUnsafe(`DELETE FROM role WHERE id = $1::uuid`, id);
        await emit(db, ctx.tenantId, EVENT_TYPES.ROLE_DELETED, { roleId: id });
        return { ok: true };
      });
    },

    async setRolePermissions(ctx, id, keys): Promise<SetPermissionsResult> {
      return withTenant<SetPermissionsResult>(ctx, async (db: Db) => {
        const existing = await db.$queryRawUnsafe<RoleRow[]>(
          `SELECT id, tenant_id, name, is_system FROM role WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (existing.length === 0) return { ok: false, reason: "not_found" };
        if (existing[0]!.is_system) return { ok: false, reason: "system_role" };

        const unique = [...new Set(keys)];
        if (unique.length > 0) {
          const known = await db.$queryRawUnsafe<{ key: string }[]>(
            `SELECT key FROM permission WHERE key = ANY($1::text[])`,
            unique,
          );
          if (known.length !== unique.length) {
            return { ok: false, reason: "unknown_permission" };
          }
        }

        // Replace the mapping set.
        await db.$executeRawUnsafe(
          `DELETE FROM role_permission WHERE role_id = $1::uuid`,
          id,
        );
        for (const key of unique) {
          await db.$executeRawUnsafe(
            `INSERT INTO role_permission (role_id, permission_key)
             VALUES ($1::uuid, $2)`,
            id,
            key,
          );
        }
        await emit(db, ctx.tenantId, EVENT_TYPES.ROLE_UPDATED, {
          roleId: id,
          permissions: unique,
        });
        return {
          ok: true,
          role: { ...toRole(existing[0]!), permissions: unique.sort() },
        };
      });
    },
  };
}
