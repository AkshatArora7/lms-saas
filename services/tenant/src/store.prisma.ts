import { controlPlane } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

import {
  subdomainFor,
  type ChildTenantFilter,
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
  parent_id: string | null;
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
    parentId: row.parent_id ?? null,
    tier: row.tier,
    status: row.status,
    region: row.region,
    planId: row.plan_id ?? null,
    subdomain: subdomainFor(row.slug),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

const SELECT_COLUMNS = `id, slug, name, kind, parent_id, tier, status, region,
  plan_id, created_at, updated_at`;

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
      return db.$transaction(async (tx) => {
        // Slug uniqueness — citext makes the comparison case-insensitive.
        const existing = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM tenant WHERE slug = $1 LIMIT 1`,
          input.slug,
        );
        if (existing.length > 0) {
          return { ok: false, reason: "slug_taken" } as ProvisionTenantResult;
        }

        // Resolve the parent (district) when registering a sub-tenant.
        let parent: TenantRow | undefined;
        if (input.parentTenantId != null) {
          const parentRows = await tx.$queryRawUnsafe<TenantRow[]>(
            `SELECT ${SELECT_COLUMNS} FROM tenant WHERE id = $1::uuid LIMIT 1`,
            input.parentTenantId,
          );
          parent = parentRows[0];
          if (!parent) {
            return { ok: false, reason: "unknown_parent" } as ProvisionTenantResult;
          }
        }

        let planId: string | null = parent?.plan_id ?? null; // inherit by default
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

        const region = input.region ?? parent?.region ?? "us-east";
        const kind = parent ? "sub" : "standalone";

        // Pool provisioning is synchronous (shared infra, nothing to stand
        // up), so the row lands directly as 'active' — the completed
        // provisioning->active transition. The 'provisioning' state exists in
        // the schema for silo tenants that must wait on infra to be built.
        const inserted = await tx.$queryRawUnsafe<TenantRow[]>(
          `INSERT INTO tenant (slug, name, kind, parent_id, tier, status, region, plan_id)
           VALUES ($1, $2, $3, $4::uuid, 'pool', 'active', $5, $6)
           RETURNING ${SELECT_COLUMNS}`,
          input.slug,
          input.name,
          kind,
          parent?.id ?? null,
          region,
          planId,
        );
        const row = inserted[0]!;
        const record = toRecord(row);

        // Promote a standalone parent to a district on its first sub-tenant.
        if (parent && parent.kind === "standalone") {
          await tx.$executeRawUnsafe(
            `UPDATE tenant SET kind = 'parent', updated_at = now() WHERE id = $1::uuid`,
            parent.id,
          );
        }

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
          kind: record.kind,
          parentId: record.parentId,
          region: record.region,
          tier: record.tier,
          subdomain: record.subdomain,
          planId: record.planId,
        };
        await tx.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, payload)
           VALUES ($1::uuid, $2, $3::jsonb)`,
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

    async listChildren(parentId: string, filter?: ChildTenantFilter) {
      const q = filter?.q?.trim();
      const rows = await db.$queryRawUnsafe<TenantRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant
          WHERE parent_id = $1::uuid
            AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%'
                                  OR slug ILIKE '%' || $2 || '%')
          ORDER BY name`,
        parentId,
        q && q.length > 0 ? q : null,
      );
      return rows.map(toRecord);
    },

    async listSubtree(rootId: string) {
      // tenant_subtree() = root + all descendants; the FK keeps it acyclic.
      const rows = await db.$queryRawUnsafe<TenantRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant
          WHERE id IN (SELECT id FROM tenant_subtree($1::uuid))
          ORDER BY created_at`,
        rootId,
      );
      return rows.map(toRecord);
    },

    async listTenants() {
      const rows = await db.$queryRawUnsafe<TenantRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant ORDER BY created_at`,
      );
      return rows.map(toRecord);
    },

    async setStatus(id, status) {
      const rows = await db.$queryRawUnsafe<TenantRow[]>(
        `UPDATE tenant SET status = $2, updated_at = now()
          WHERE id = $1::uuid
        RETURNING ${SELECT_COLUMNS}`,
        id,
        status,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },
  };
}
