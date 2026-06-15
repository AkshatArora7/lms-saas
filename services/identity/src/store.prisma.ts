import { withTenant } from "@lms/db";
import type { StandardRole, TenantContext } from "@lms/types";

import type {
  AuthUserRecord,
  IdentityProviderRecord,
  IdentityStore,
  NewRefreshRecord,
  RefreshRecord,
  RolesAndScopes,
  SsoProvisionInput,
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

    async getParentTenantId(ctx): Promise<string | null> {
      if (ctx.parentTenantId !== undefined) return ctx.parentTenantId;
      return withTenant(ctx, async (db) => {
        // `tenant` is the control-plane registry (not RLS-scoped): a direct
        // lookup of this tenant's parent is safe and the query is keyed by id.
        const rows = await db.$queryRawUnsafe<
          Array<{ parent_id: string | null }>
        >(
          `SELECT parent_id FROM tenant WHERE id = $1 LIMIT 1`,
          ctx.tenantId,
        );
        return rows[0]?.parent_id ?? null;
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

    async findIdentityProvider(
      ctx,
      providerId,
    ): Promise<IdentityProviderRecord | null> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<
          Array<{
            id: string;
            tenant_id: string;
            kind: IdentityProviderRecord["kind"];
            display_name: string;
            config: Record<string, unknown> | null;
            is_enabled: boolean;
          }>
        >(
          `SELECT id, tenant_id, kind, display_name, config, is_enabled
             FROM identity_provider
            WHERE id = $1
            LIMIT 1`,
          providerId,
        );
        const row = rows[0];
        if (!row) return null;
        return {
          id: row.id,
          tenantId: row.tenant_id,
          kind: row.kind,
          displayName: row.display_name,
          config: row.config ?? {},
          isEnabled: row.is_enabled,
        } satisfies IdentityProviderRecord;
      });
    },

    async upsertSsoUser(
      ctx: TenantContext,
      input: SsoProvisionInput,
    ): Promise<AuthUserRecord> {
      return withTenant(ctx, async (db) => {
        // 1. Already linked via user_identity.
        const linked = await db.$queryRawUnsafe<
          Array<{
            id: string;
            tenant_id: string;
            display_name: string;
            status: AuthUserRecord["status"];
          }>
        >(
          `SELECT u.id, u.tenant_id, u.display_name, u.status
             FROM user_identity ui
             JOIN app_user u ON u.id = ui.user_id
            WHERE ui.provider_id = $1 AND ui.subject = $2
            LIMIT 1`,
          input.providerId,
          input.subject,
        );
        if (linked[0]) {
          const r = linked[0];
          return {
            id: r.id,
            tenantId: r.tenant_id,
            displayName: r.display_name,
            status: r.status,
            passwordHash: null,
          } satisfies AuthUserRecord;
        }

        // 2. Existing local user with the same email — link a new identity.
        const existing = await db.$queryRawUnsafe<
          Array<{
            id: string;
            tenant_id: string;
            display_name: string;
            status: AuthUserRecord["status"];
          }>
        >(
          `SELECT id, tenant_id, display_name, status
             FROM app_user
            WHERE email = $1
            LIMIT 1`,
          input.email,
        );
        let userId: string;
        let record: AuthUserRecord;
        if (existing[0]) {
          const r = existing[0];
          userId = r.id;
          record = {
            id: r.id,
            tenantId: r.tenant_id,
            displayName: r.display_name,
            status: r.status,
            passwordHash: null,
          };
        } else {
          // 3. Brand-new JIT user (active, external_id = subject, no password).
          const inserted = await db.$queryRawUnsafe<Array<{ id: string }>>(
            `INSERT INTO app_user (tenant_id, email, display_name, status, external_id)
             VALUES ($1, $2, $3, 'active', $4)
             RETURNING id`,
            ctx.tenantId,
            input.email,
            input.displayName,
            input.subject,
          );
          const row = inserted[0];
          if (!row) {
            throw new Error("failed to provision SSO user");
          }
          userId = row.id;
          record = {
            id: userId,
            tenantId: ctx.tenantId,
            displayName: input.displayName,
            status: "active",
            passwordHash: null,
          };

          // Grant the default JIT roles at the tenant's root org unit.
          // Best-effort: only inserts when both the role and a root unit exist.
          for (const roleName of input.defaultRoles ?? []) {
            await db.$executeRawUnsafe(
              `INSERT INTO role_assignment (tenant_id, user_id, role_id, org_unit_id)
               SELECT $1, $2, r.id, ou.id
                 FROM role r
                 JOIN org_unit ou
                   ON ou.tenant_id = $1 AND ou.parent_id IS NULL
                WHERE r.tenant_id = $1 AND r.name = $3
                LIMIT 1
               ON CONFLICT DO NOTHING`,
              ctx.tenantId,
              userId,
              roleName,
            );
          }
        }

        await db.$executeRawUnsafe(
          `INSERT INTO user_identity (tenant_id, user_id, provider_id, subject)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (provider_id, subject) DO NOTHING`,
          ctx.tenantId,
          userId,
          input.providerId,
          input.subject,
        );

        return record;
      });
    },
  };
}
