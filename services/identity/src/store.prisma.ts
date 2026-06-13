import { withTenant } from "@lms/db";
import type { StandardRole, TenantContext } from "@lms/types";

import type {
  AuthUserRecord,
  IdentityStore,
  NewRefreshRecord,
  RefreshRecord,
  RolesAndScopes,
} from "./store.js";

/**
 * Postgres-backed identity store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants. Parameterised
 * raw SQL keeps this independent of the generated Prisma client surface.
 */
export function createPrismaStore(): IdentityStore {
  return {
    async findUserByEmail(ctx, email) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<
          Array<{
            id: string;
            tenant_id: string;
            display_name: string;
            status: AuthUserRecord["status"];
            password_hash: string | null;
          }>
        >(
          `SELECT u.id, u.tenant_id, u.display_name, u.status, c.password_hash
             FROM app_user u
             LEFT JOIN user_credential c ON c.user_id = u.id
            WHERE u.email = $1
            LIMIT 1`,
          email,
        );
        const row = rows[0];
        if (!row) return null;
        return {
          id: row.id,
          tenantId: row.tenant_id,
          displayName: row.display_name,
          status: row.status,
          passwordHash: row.password_hash,
        } satisfies AuthUserRecord;
      });
    },

    async getRolesAndScopes(ctx, userId): Promise<RolesAndScopes> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<
          Array<{ role_name: string; permission_key: string | null }>
        >(
          `SELECT r.name AS role_name, rp.permission_key
             FROM role_assignment ra
             JOIN role r ON r.id = ra.role_id
             LEFT JOIN role_permission rp ON rp.role_id = r.id
            WHERE ra.user_id = $1`,
          userId,
        );
        const roles = new Set<string>();
        const scopes = new Set<string>();
        for (const row of rows) {
          roles.add(row.role_name);
          if (row.permission_key) scopes.add(row.permission_key);
        }
        return {
          roles: [...roles] as StandardRole[],
          scopes: [...scopes],
        };
      });
    },

    async insertRefreshToken(ctx, rec: NewRefreshRecord) {
      await withTenant(ctx, async (db) => {
        await db.$executeRawUnsafe(
          `INSERT INTO refresh_token
             (id, tenant_id, user_id, family_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          rec.id,
          rec.tenantId,
          rec.userId,
          rec.familyId,
          rec.tokenHash,
          rec.expiresAt,
        );
      });
    },

    async findRefreshByHash(ctx, tokenHash): Promise<RefreshRecord | null> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<
          Array<{
            id: string;
            tenant_id: string;
            user_id: string;
            family_id: string;
            token_hash: string;
            expires_at: Date;
            revoked_at: Date | null;
            replaced_by: string | null;
          }>
        >(
          `SELECT id, tenant_id, user_id, family_id, token_hash,
                  expires_at, revoked_at, replaced_by
             FROM refresh_token
            WHERE token_hash = $1
            LIMIT 1`,
          tokenHash,
        );
        const row = rows[0];
        if (!row) return null;
        return {
          id: row.id,
          tenantId: row.tenant_id,
          userId: row.user_id,
          familyId: row.family_id,
          tokenHash: row.token_hash,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          replacedBy: row.replaced_by,
        } satisfies RefreshRecord;
      });
    },

    async revokeRefreshToken(ctx: TenantContext, id, replacedBy = null) {
      await withTenant(ctx, async (db) => {
        await db.$executeRawUnsafe(
          `UPDATE refresh_token
              SET revoked_at = now(), replaced_by = $2
            WHERE id = $1 AND revoked_at IS NULL`,
          id,
          replacedBy,
        );
      });
    },

    async revokeFamily(ctx: TenantContext, familyId) {
      await withTenant(ctx, async (db) => {
        await db.$executeRawUnsafe(
          `UPDATE refresh_token
              SET revoked_at = now()
            WHERE family_id = $1 AND revoked_at IS NULL`,
          familyId,
        );
      });
    },
  };
}
