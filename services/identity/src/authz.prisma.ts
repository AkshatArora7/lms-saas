import { withTenant } from "@lms/db";

import type { AuthzStore, Grant, OrgUnitAncestry } from "./authz.js";

interface GrantRow {
  role_id: string;
  role_name: string;
  permission_key: string;
  org_unit_id: string;
  cascade: boolean;
}

interface OrgUnitRow {
  id: string;
  path: string[];
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
}

/** RLS-scoped authorization reads (uuid params cast). */
export function createPrismaAuthzStore(): AuthzStore {
  return {
    async listGrants(ctx, userId): Promise<Grant[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<GrantRow[]>(
          `SELECT ra.role_id, r.name AS role_name, rp.permission_key,
                  ra.org_unit_id, ra.cascade
             FROM role_assignment ra
             JOIN role r ON r.id = ra.role_id
             JOIN role_permission rp ON rp.role_id = ra.role_id
            WHERE ra.user_id = $1::uuid`,
          userId,
        );
        return rows.map((row) => ({
          roleId: row.role_id,
          roleName: row.role_name,
          permission: row.permission_key,
          orgUnitId: row.org_unit_id,
          cascade: row.cascade,
        }));
      });
    },

    async getAncestry(ctx, orgUnitId): Promise<OrgUnitAncestry | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
          `SELECT id, path FROM org_unit WHERE id = $1::uuid LIMIT 1`,
          orgUnitId,
        );
        const row = rows[0];
        if (!row) return null;
        return { id: row.id, path: (row.path ?? []).map(String) };
      });
    },
  };
}
