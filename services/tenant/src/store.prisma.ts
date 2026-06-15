import { controlPlane } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

import {
  subdomainFor,
  type ProvisionTenantInput,
  type ProvisionTenantResult,
  type TenantKind,
  type TenantRecord,
  type TenantStatus,
  type TenantStore,
  type TenantTier,
} from "./store.js";

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  kind: TenantKind;
  tier: TenantTier;
  status: TenantStatus;
  region: string;
  plan_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    tier: row.tier,
    status: row.status,
    region: row.region,
    planId: row.plan_id ?? null,
    subdomain: subdomainFor(row.slug),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

const SELECT_COLUMNS = `id, slug, name, kind, tier, status, region, plan_id,
  created_at, updated_at`;

/**
 * Control-plane tenant store. The `tenant` table is the tenant registry itself
 * and is OUTSIDE RLS, so every statement runs through `controlPlane()` (a non
 * tenant-scoped client) — never `withTenant`. Provisioning the tenant row and
 * the `tenant.provisioned` outbox row share ONE transaction so they commit
 * atomically (transactional outbox); the FK `event_outbox.tenant_id -> tenant`
 * is satisfied because the outbox row is inserted after, with the new id.
 */
export function createPrismaStore(): TenantStore {
  const db = controlPlane();
  return {
    async provisionTenant(
      input: ProvisionTenantInput,
    ): Promise<ProvisionTenantResult> {
      const region = input.region ?? "us-east";
      return db.$transaction(async (tx) => {
        // Slug uniqueness — citext makes the comparison case-insensitive.
        const existing = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM tenant WHERE slug = $1 LIMIT 1`,
          input.slug,
        );
        if (existing.length > 0) {
          return { ok: false, reason: "slug_taken" } as ProvisionTenantResult;
        }

        let planId: string | null = null;
        if (input.plan !== undefined) {
          const planRows = await tx.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM plan WHERE code = $1 LIMIT 1`,
            input.plan,
          );
          const resolved = planRows[0]?.id;
          if (!resolved) {
            return {
              ok: false,
              reason: "unknown_plan",
            } as ProvisionTenantResult;
          }
          planId = resolved;
        }

        // Pool provisioning is synchronous (shared infra, nothing to stand
        // up), so the row lands directly as 'active' — the completed
        // provisioning->active transition. The 'provisioning' state exists in
        // the schema for silo tenants that must wait on infra to be built.
        const inserted = await tx.$queryRawUnsafe<TenantRow[]>(
          `INSERT INTO tenant (slug, name, kind, tier, status, region, plan_id)
           VALUES ($1, $2, 'standalone', 'pool', 'active', $3, $4)
           RETURNING ${SELECT_COLUMNS}`,
          input.slug,
          input.name,
          region,
          planId,
        );
        const row = inserted[0]!;
        const record = toRecord(row);

        // event_outbox is RLS-scoped under FORCE ROW LEVEL SECURITY, so this
        // control-plane provisioning tx must establish the new tenant's RLS
        // context before writing its outbox row — otherwise current_tenant_id()
        // is NULL, the WITH CHECK (tenant_id = current_tenant_id()) rejects the
        // INSERT, and the whole transaction aborts. The third arg `true` makes
        // the GUC transaction-local so it auto-resets at commit/rollback and
        // cannot leak onto a pooled connection (mirrors withTenant in @lms/db).
        await tx.$executeRawUnsafe(
          "SELECT set_config('app.tenant_id', $1, true)",
          record.id,
        );

        // Transactional outbox: emit `tenant.provisioned` in the SAME tx. Uses
        // the new tenant's own id for event_outbox.tenant_id (FK -> tenant).
        const payload = {
          slug: record.slug,
          name: record.name,
          region: record.region,
          tier: record.tier,
          subdomain: record.subdomain,
          planId: record.planId,
        };
        await tx.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, payload)
           VALUES ($1, $2, $3::jsonb)`,
          record.id,
          EVENT_TYPES.TENANT_PROVISIONED,
          JSON.stringify(payload),
        );

        return { ok: true, tenant: record } as ProvisionTenantResult;
      });
    },

    async getTenant(id) {
      const rows = await db.$queryRawUnsafe<TenantRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant WHERE id = $1 LIMIT 1`,
        id,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async getTenantBySlug(slug) {
      const rows = await db.$queryRawUnsafe<TenantRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant WHERE slug = $1 LIMIT 1`,
        slug,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async listTenants() {
      const rows = await db.$queryRawUnsafe<TenantRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant ORDER BY created_at`,
      );
      return rows.map(toRecord);
    },
  };
}
