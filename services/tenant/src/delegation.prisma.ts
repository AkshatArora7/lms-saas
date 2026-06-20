import { controlPlane } from "@lms/db";

import type {
  CreateDelegationResult,
  DelegationRecord,
  DelegationStore,
  NewDelegationInput,
} from "./delegation.js";

interface DelegationRow {
  id: string;
  delegator_tenant_id: string;
  scope_tenant_id: string;
  delegate_user_id: string;
  role: string;
  created_at: Date | string;
  revoked_at: Date | string | null;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: DelegationRow): DelegationRecord {
  return {
    id: row.id,
    delegatorTenantId: row.delegator_tenant_id,
    scopeTenantId: row.scope_tenant_id,
    delegateUserId: row.delegate_user_id,
    role: row.role,
    createdAt: asIso(row.created_at) ?? "",
    revokedAt: asIso(row.revoked_at),
  };
}

const SELECT = `
  SELECT id, delegator_tenant_id, scope_tenant_id, delegate_user_id, role,
         created_at, revoked_at
    FROM tenant_admin_delegation`;

/**
 * Control-plane delegation store. Descendant checks reuse the schema's
 * `tenant_subtree()` helper; the delegation table is control-plane (not RLS),
 * so this runs against `controlPlane()`, never `withTenant`.
 */
export function createPrismaDelegationStore(): DelegationStore {
  // Resolve the control-plane client lazily so building the app never requires a
  // live DB (tests inject the memory store; only real calls touch Postgres).
  const cp = (): Db => controlPlane() as unknown as Db;

  async function descendant(
    targetTenantId: string,
    ancestorTenantId: string,
  ): Promise<boolean> {
    if (targetTenantId === ancestorTenantId) return false;
    const rows = await cp().$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM tenant_subtree($1::uuid) WHERE id = $2::uuid
       ) AS ok`,
      ancestorTenantId,
      targetTenantId,
    );
    return rows[0]?.ok ?? false;
  }

  return {
    async createDelegation(
      input: NewDelegationInput,
    ): Promise<CreateDelegationResult> {
      const exists = await cp().$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM tenant WHERE id = $1::uuid OR id = $2::uuid`,
        input.delegatorTenantId,
        input.scopeTenantId,
      );
      if (exists.length < 2) return { ok: false, reason: "unknown_tenant" };
      if (!(await descendant(input.scopeTenantId, input.delegatorTenantId))) {
        return { ok: false, reason: "scope_not_descendant" };
      }
      const rows = await cp().$queryRawUnsafe<DelegationRow[]>(
        `INSERT INTO tenant_admin_delegation
           (delegator_tenant_id, scope_tenant_id, delegate_user_id, role)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
         ON CONFLICT (scope_tenant_id, delegate_user_id, role)
         DO UPDATE SET revoked_at = NULL
         RETURNING id, delegator_tenant_id, scope_tenant_id, delegate_user_id,
                   role, created_at, revoked_at`,
        input.delegatorTenantId,
        input.scopeTenantId,
        input.delegateUserId,
        input.role ?? "school_admin",
      );
      return { ok: true, delegation: toRecord(rows[0]!) };
    },

    async listDelegations(scopeTenantId): Promise<DelegationRecord[]> {
      const rows = await cp().$queryRawUnsafe<DelegationRow[]>(
        `${SELECT} WHERE scope_tenant_id = $1::uuid AND revoked_at IS NULL
          ORDER BY created_at`,
        scopeTenantId,
      );
      return rows.map(toRecord);
    },

    async revokeDelegation(id): Promise<DelegationRecord | null> {
      const rows = await cp().$queryRawUnsafe<DelegationRow[]>(
        `UPDATE tenant_admin_delegation SET revoked_at = now()
          WHERE id = $1::uuid
        RETURNING id, delegator_tenant_id, scope_tenant_id, delegate_user_id,
                  role, created_at, revoked_at`,
        id,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    isDescendant: descendant,

    async hasActiveDelegation(scopeTenantId, userId): Promise<boolean> {
      const rows = await cp().$queryRawUnsafe<{ ok: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM tenant_admin_delegation
            WHERE scope_tenant_id = $1::uuid
              AND delegate_user_id = $2::uuid
              AND revoked_at IS NULL
         ) AS ok`,
        scopeTenantId,
        userId,
      );
      return rows[0]?.ok ?? false;
    },
  };
}
