import { withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

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
  OrgUnitType,
  UpdateOrgUnitInput,
  UpdateUserInput,
  UserFilter,
  UserOrgStore,
  UserProfile,
  UserRecord,
} from "./store.js";

interface OrgUnitRow {
  id: string;
  tenant_id: string;
  type: OrgUnitType;
  parent_id: string | null;
  name: string;
  code: string | null;
  path: string[];
  is_active: boolean;
  created_at: Date | string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  status: UserRecord["status"];
  locale: string;
  created_at: Date | string;
}

interface MembershipRow {
  id: string;
  role_id: string;
  role_name: string;
  org_unit_id: string;
  cascade: boolean;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toOrgUnit(row: OrgUnitRow): OrgUnitRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    parentId: row.parent_id,
    name: row.name,
    code: row.code,
    path: row.path ?? [],
    isActive: row.is_active,
    createdAt: iso(row.created_at),
  };
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    locale: row.locale,
    createdAt: iso(row.created_at),
  };
}

function toMembership(row: MembershipRow): MembershipRecord {
  return {
    assignmentId: row.id,
    roleId: row.role_id,
    roleName: row.role_name,
    orgUnitId: row.org_unit_id,
    cascade: row.cascade,
  };
}

const ORG_COLUMNS = `id, tenant_id, type, parent_id, name, code, path, is_active, created_at`;
const USER_COLUMNS = `id, tenant_id, email, display_name, status, locale, created_at`;

/** Minimal raw-SQL surface, so the store can run inside withTenant's tx. */
interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

/**
 * Write a transactional outbox row in the SAME tx as the domain change. The
 * relay (services/relay) drains it and the notification consumer fans it out.
 * Runs under the tenant GUC set by withTenant, so the outbox RLS WITH CHECK
 * (tenant_id = current_tenant_id()) passes.
 */
async function emitEvent(
  db: Db,
  tenantId: string,
  type: string,
  orgUnitId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO event_outbox (tenant_id, type, org_unit_id, payload)
     VALUES ($1::uuid, $2, $3::uuid, $4::jsonb)`,
    tenantId,
    type,
    orgUnitId,
    JSON.stringify(payload),
  );
}

/**
 * Postgres-backed user-org store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants. Every uuid
 * parameter is explicitly cast (`$n::uuid`) because Prisma's $queryRawUnsafe
 * binds string args as text, which Postgres will not coerce to uuid.
 */
export function createPrismaStore(): UserOrgStore {
  return {
    // --- Org-unit tree -----------------------------------------------------
    async createOrgUnit(ctx, input: NewOrgUnitInput) {
      return withTenant<CreateOrgUnitResult>(ctx, async (db) => {
        let path: string[] = [];
        if (input.parentId) {
          const parent = await db.$queryRawUnsafe<
            { id: string; path: string[] }[]
          >(
            `SELECT id, path FROM org_unit WHERE id = $1::uuid LIMIT 1`,
            input.parentId,
          );
          if (parent.length === 0) return { ok: false, reason: "unknown_parent" };
          path = [...(parent[0]!.path ?? []), parent[0]!.id];
        }
        const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
          `INSERT INTO org_unit (tenant_id, type, parent_id, name, code, path)
           VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid[])
           RETURNING ${ORG_COLUMNS}`,
          ctx.tenantId,
          input.type,
          input.parentId ?? null,
          input.name,
          input.code ?? null,
          path,
        );
        const orgUnit = toOrgUnit(rows[0]!);
        await emitEvent(db, ctx.tenantId, EVENT_TYPES.ORGUNIT_CREATED, orgUnit.id, {
          type: orgUnit.type,
          name: orgUnit.name,
          parentId: orgUnit.parentId,
        });
        return { ok: true, orgUnit };
      });
    },

    async getOrgUnit(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
          `SELECT ${ORG_COLUMNS} FROM org_unit WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toOrgUnit(rows[0]) : null;
      });
    },

    async listOrgUnits(ctx, filter: OrgUnitFilter = {}) {
      return withTenant(ctx, async (db) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filter.parentId) {
          params.push(filter.parentId);
          conditions.push(`parent_id = $${params.length}::uuid`);
        }
        if (filter.type) {
          params.push(filter.type);
          conditions.push(`type = $${params.length}`);
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
          `SELECT ${ORG_COLUMNS} FROM org_unit ${where} ORDER BY type, name`,
          ...params,
        );
        return rows.map(toOrgUnit);
      });
    },

    async getSubtree(ctx, id) {
      return withTenant(ctx, async (db) => {
        // Descendants: any node whose materialised path contains this id. The
        // GIN index ix_org_unit_path backs the ANY(path) membership test.
        const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
          `SELECT ${ORG_COLUMNS} FROM org_unit
            WHERE $1::uuid = ANY(path)
            ORDER BY array_length(path, 1), type, name`,
          id,
        );
        return rows.map(toOrgUnit);
      });
    },

    async getAncestors(ctx, id) {
      return withTenant(ctx, async (db) => {
        const self = await db.$queryRawUnsafe<{ path: string[] }[]>(
          `SELECT path FROM org_unit WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        const path = self[0]?.path ?? [];
        if (path.length === 0) return [];
        const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
          `SELECT ${ORG_COLUMNS} FROM org_unit WHERE id = ANY($1::uuid[])`,
          path,
        );
        // Order root-first to match the path order.
        const order = new Map(path.map((pid, i) => [pid, i]));
        return rows
          .map(toOrgUnit)
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      });
    },

    async updateOrgUnit(ctx, id, input: UpdateOrgUnitInput) {
      return withTenant(ctx, async (db) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (input.name !== undefined) {
          params.push(input.name);
          sets.push(`name = $${params.length}`);
        }
        if (input.code !== undefined) {
          params.push(input.code);
          sets.push(`code = $${params.length}`);
        }
        if (input.isActive !== undefined) {
          params.push(input.isActive);
          sets.push(`is_active = $${params.length}`);
        }
        if (sets.length === 0) {
          const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
            `SELECT ${ORG_COLUMNS} FROM org_unit WHERE id = $1::uuid LIMIT 1`,
            id,
          );
          return rows[0] ? toOrgUnit(rows[0]) : null;
        }
        params.push(id);
        const rows = await db.$queryRawUnsafe<OrgUnitRow[]>(
          `UPDATE org_unit SET ${sets.join(", ")}
            WHERE id = $${params.length}::uuid
            RETURNING ${ORG_COLUMNS}`,
          ...params,
        );
        return rows[0] ? toOrgUnit(rows[0]) : null;
      });
    },

    // --- Users & roles -----------------------------------------------------
    async createUser(ctx, input: NewUserInput) {
      return withTenant<CreateUserResult>(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<UserRow[]>(
          `INSERT INTO app_user (tenant_id, email, display_name, status, locale)
           VALUES ($1::uuid, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, email) DO NOTHING
           RETURNING ${USER_COLUMNS}`,
          ctx.tenantId,
          input.email,
          input.displayName,
          input.status ?? "invited",
          input.locale ?? "en",
        );
        if (rows.length === 0) return { ok: false, reason: "email_taken" };
        const user = toUser(rows[0]!);
        await emitEvent(db, ctx.tenantId, EVENT_TYPES.USER_CREATED, null, {
          userId: user.id,
          email: user.email,
          status: user.status,
        });
        return { ok: true, user };
      });
    },

    async getUser(ctx, id): Promise<UserProfile | null> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<UserRow[]>(
          `SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (rows.length === 0) return null;
        const memberships = await db.$queryRawUnsafe<MembershipRow[]>(
          `SELECT ra.id, ra.role_id, r.name AS role_name,
                  ra.org_unit_id, ra.cascade
             FROM role_assignment ra
             JOIN role r ON r.id = ra.role_id
            WHERE ra.user_id = $1::uuid
            ORDER BY ra.created_at`,
          id,
        );
        return {
          ...toUser(rows[0]!),
          memberships: memberships.map(toMembership),
        };
      });
    },

    async listUsers(ctx, filter: UserFilter = {}) {
      return withTenant(ctx, async (db) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let from = "app_user u";
        if (filter.orgUnitId) {
          from = `app_user u
            JOIN role_assignment ra ON ra.user_id = u.id`;
          params.push(filter.orgUnitId);
          conditions.push(`ra.org_unit_id = $${params.length}::uuid`);
        }
        if (filter.status) {
          params.push(filter.status);
          conditions.push(`u.status = $${params.length}`);
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const rows = await db.$queryRawUnsafe<UserRow[]>(
          `SELECT DISTINCT u.id, u.tenant_id, u.email, u.display_name,
                  u.status, u.locale, u.created_at
             FROM ${from} ${where}
            ORDER BY u.display_name`,
          ...params,
        );
        return rows.map(toUser);
      });
    },

    async updateUser(ctx, id, input: UpdateUserInput) {
      return withTenant(ctx, async (db) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (input.displayName !== undefined) {
          params.push(input.displayName);
          sets.push(`display_name = $${params.length}`);
        }
        if (input.status !== undefined) {
          params.push(input.status);
          sets.push(`status = $${params.length}`);
        }
        if (input.locale !== undefined) {
          params.push(input.locale);
          sets.push(`locale = $${params.length}`);
        }
        if (sets.length === 0) {
          const rows = await db.$queryRawUnsafe<UserRow[]>(
            `SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1::uuid LIMIT 1`,
            id,
          );
          return rows[0] ? toUser(rows[0]) : null;
        }
        params.push(id);
        const rows = await db.$queryRawUnsafe<UserRow[]>(
          `UPDATE app_user SET ${sets.join(", ")}
            WHERE id = $${params.length}::uuid
            RETURNING ${USER_COLUMNS}`,
          ...params,
        );
        if (rows.length === 0) return null;
        const user = toUser(rows[0]!);
        const type =
          input.status === "inactive"
            ? EVENT_TYPES.USER_DEACTIVATED
            : EVENT_TYPES.USER_UPDATED;
        await emitEvent(db, ctx.tenantId, type, null, {
          userId: user.id,
          status: user.status,
        });
        return user;
      });
    },

    async assignRole(ctx, userId, input: AssignRoleInput) {
      return withTenant<AssignRoleResult>(ctx, async (db) => {
        const userRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM app_user WHERE id = $1::uuid LIMIT 1`,
          userId,
        );
        if (userRows.length === 0) return { ok: false, reason: "user_not_found" };

        const orgRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM org_unit WHERE id = $1::uuid LIMIT 1`,
          input.orgUnitId,
        );
        if (orgRows.length === 0) {
          return { ok: false, reason: "unknown_org_unit" };
        }

        const roleRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM role WHERE name = $1 LIMIT 1`,
          input.role,
        );
        const roleId = roleRows[0]?.id;
        if (!roleId) return { ok: false, reason: "unknown_role" };

        const rows = await db.$queryRawUnsafe<MembershipRow[]>(
          `INSERT INTO role_assignment
             (tenant_id, user_id, role_id, org_unit_id, cascade)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)
           ON CONFLICT (user_id, role_id, org_unit_id)
           DO UPDATE SET cascade = EXCLUDED.cascade
           RETURNING id, role_id,
                     (SELECT name FROM role WHERE id = $3::uuid) AS role_name,
                     org_unit_id, cascade`,
          ctx.tenantId,
          userId,
          roleId,
          input.orgUnitId,
          input.cascade ?? true,
        );
        return { ok: true, membership: toMembership(rows[0]!) };
      });
    },

    async revokeRole(ctx, userId, assignmentId) {
      return withTenant(ctx, async (db) => {
        const affected = await db.$executeRawUnsafe(
          `DELETE FROM role_assignment
            WHERE id = $1::uuid AND user_id = $2::uuid`,
          assignmentId,
          userId,
        );
        return affected > 0;
      });
    },
  };
}
