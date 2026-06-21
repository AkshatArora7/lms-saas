import { withTenant } from "@lms/db";

import type {
  ClassUpsertInput,
  ClassUpsertResult,
  EntityType,
  EnrollmentUpsertInput,
  IdMapEntry,
  OrgUpsertInput,
  SisStore,
  SisSyncRun,
  SyncMode,
  UpsertResult,
  UserUpsertInput,
} from "./store.js";

/**
 * RLS-scoped sis store. Every write runs through `withTenant`, so Postgres RLS
 * scopes it to the caller's tenant — there are NO manual `tenant_id = $1` WHERE
 * clauses (ADR-0014; mirrors analytics' store.prisma.ts). uuid params are cast
 * with `::uuid`; jsonb is passed as `$N::jsonb` with JSON.stringify. The
 * idempotency invariant: every domain upsert writes its `sis_id_map` row in the
 * same transaction, keyed on the composite PK `(tenant_id, entity_type,
 * source_id)` — sis_id_map has NO surrogate id column.
 */

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

interface SyncRow {
  id: string;
  tenant_id: string;
  source: string;
  status: string;
  last_run_at: Date | string | null;
  stats: unknown;
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toRun(row: SyncRow): SisSyncRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source,
    status: row.status as SisSyncRun["status"],
    lastRunAt: asIso(row.last_run_at),
    stats: asObject(row.stats),
  };
}

const RUN_SELECT = `SELECT id, tenant_id, source, status, last_run_at, stats FROM sis_sync`;

/** Record the sourcedId↔internal-id mapping (upsert on the composite PK). */
async function recordIdMapTx(
  db: Db,
  tenantId: string,
  entityType: EntityType,
  sourceId: string,
  internalId: string,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO sis_id_map (tenant_id, entity_type, source_id, internal_id, last_seen_at)
       VALUES ($1::uuid, $2, $3, $4::uuid, now())
     ON CONFLICT (tenant_id, entity_type, source_id)
       DO UPDATE SET internal_id = EXCLUDED.internal_id, last_seen_at = now()`,
    tenantId,
    entityType,
    sourceId,
    internalId,
  );
}

async function lookupIdTx(
  db: Db,
  entityType: EntityType,
  sourceId: string,
): Promise<string | null> {
  const rows = await db.$queryRawUnsafe<{ internal_id: string }[]>(
    `SELECT internal_id FROM sis_id_map WHERE entity_type = $1 AND source_id = $2`,
    entityType,
    sourceId,
  );
  return rows[0]?.internal_id ?? null;
}

export function createPrismaStore(): SisStore {
  return {
    // --- run lifecycle ---
    async startSyncRun(ctx, input: { source: string; mode: SyncMode; since: string | null }) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<SyncRow[]>(
          `INSERT INTO sis_sync (tenant_id, source, status, last_run_at, stats)
             VALUES ($1::uuid, $2, 'running', now(), $3::jsonb)
           RETURNING id, tenant_id, source, status, last_run_at, stats`,
          ctx.tenantId,
          input.source,
          JSON.stringify({ mode: input.mode, since: input.since }),
        );
        return toRun(rows[0]!);
      });
    },

    async finishSyncRun(ctx, runId, input) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<SyncRow[]>(
          `UPDATE sis_sync
              SET status = $2, stats = $3::jsonb, last_run_at = now()
            WHERE id = $1::uuid
          RETURNING id, tenant_id, source, status, last_run_at, stats`,
          runId,
          input.status,
          JSON.stringify(input.stats),
        );
        if (!rows[0]) throw new Error("run not found");
        return toRun(rows[0]);
      });
    },

    async getSyncRun(ctx, runId) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<SyncRow[]>(
          `${RUN_SELECT} WHERE id = $1::uuid`,
          runId,
        );
        return rows[0] ? toRun(rows[0]) : null;
      });
    },

    async listSyncRuns(ctx, opts) {
      return withTenant(ctx, async (db: Db) => {
        const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
        const rows = await db.$queryRawUnsafe<SyncRow[]>(
          `${RUN_SELECT} ORDER BY last_run_at DESC NULLS LAST LIMIT $1`,
          limit,
        );
        return rows.map(toRun);
      });
    },

    async lastSuccessfulSyncAt(ctx, source) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<{ last_run_at: Date | string | null }[]>(
          `SELECT max(last_run_at) AS last_run_at
             FROM sis_sync
            WHERE source = $1 AND status = 'succeeded'`,
          source,
        );
        return asIso(rows[0]?.last_run_at ?? null);
      });
    },

    // --- id-map ---
    async lookupInternalId(ctx, entityType, sourceId) {
      return withTenant(ctx, async (db: Db) => lookupIdTx(db, entityType, sourceId));
    },

    async recordIdMap(ctx, entityType, sourceId, internalId) {
      await withTenant(ctx, async (db: Db) =>
        recordIdMapTx(db, ctx.tenantId, entityType, sourceId, internalId),
      );
    },

    async listIdMap(ctx, opts) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<
          {
            entity_type: string;
            source_id: string;
            internal_id: string;
            last_seen_at: Date | string;
          }[]
        >(
          `SELECT entity_type, source_id, internal_id, last_seen_at
             FROM sis_id_map
            WHERE ($1::text IS NULL OR entity_type = $1)
            ORDER BY entity_type, source_id`,
          opts?.entityType ?? null,
        );
        return rows.map(
          (r): IdMapEntry => ({
            entityType: r.entity_type as EntityType,
            sourceId: r.source_id,
            internalId: r.internal_id,
            lastSeenAt: asIso(r.last_seen_at) ?? "",
          }),
        );
      });
    },

    // --- domain upserts ---
    async upsertOrgUnit(ctx, input: OrgUpsertInput): Promise<UpsertResult> {
      return withTenant(ctx, async (db: Db) => {
        const existing = await lookupIdTx(db, "org", input.sourcedId);
        let internalId: string;
        let created: boolean;
        if (existing) {
          await db.$executeRawUnsafe(
            `UPDATE org_unit
                SET type = $2, name = $3, code = $4, parent_id = $5::uuid,
                    is_active = $6
              WHERE id = $1::uuid`,
            existing,
            input.type,
            input.name,
            input.code,
            input.parentInternalId,
            input.isActive,
          );
          internalId = existing;
          created = false;
        } else {
          const rows = await db.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO org_unit (tenant_id, type, name, code, parent_id, is_active)
               VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6)
             RETURNING id`,
            ctx.tenantId,
            input.type,
            input.name,
            input.code,
            input.parentInternalId,
            input.isActive,
          );
          internalId = rows[0]!.id;
          created = true;
        }
        await recordIdMapTx(db, ctx.tenantId, "org", input.sourcedId, internalId);
        return { internalId, created };
      });
    },

    async upsertUser(ctx, input: UserUpsertInput): Promise<UpsertResult> {
      return withTenant(ctx, async (db: Db) => {
        // Reconcile on the (tenant_id, email) unique key, carrying external_id.
        const rows = await db.$queryRawUnsafe<{ id: string; inserted: boolean }[]>(
          `INSERT INTO app_user (tenant_id, email, display_name, status, external_id)
             VALUES ($1::uuid, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, email)
             DO UPDATE SET display_name = EXCLUDED.display_name,
                           status = EXCLUDED.status,
                           external_id = EXCLUDED.external_id
           RETURNING id, (xmax = 0) AS inserted`,
          ctx.tenantId,
          input.email,
          input.displayName,
          input.status,
          input.sourcedId,
        );
        const internalId = rows[0]!.id;
        const created = rows[0]!.inserted === true;
        await recordIdMapTx(db, ctx.tenantId, "user", input.sourcedId, internalId);
        return { internalId, created };
      });
    },

    async upsertCourseClass(
      ctx,
      input: ClassUpsertInput,
    ): Promise<ClassUpsertResult> {
      return withTenant(ctx, async (db: Db) => {
        const existing = await lookupIdTx(db, "class", input.sourcedId);
        let orgUnitId: string;
        let created: boolean;
        if (existing) {
          await db.$executeRawUnsafe(
            `UPDATE org_unit
                SET name = $2, parent_id = $3::uuid
              WHERE id = $1::uuid`,
            existing,
            input.title,
            input.schoolInternalId,
          );
          orgUnitId = existing;
          created = false;
        } else {
          const rows = await db.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO org_unit (tenant_id, type, name, parent_id, is_active)
               VALUES ($1::uuid, 'course_offering', $2, $3::uuid, true)
             RETURNING id`,
            ctx.tenantId,
            input.title,
            input.schoolInternalId,
          );
          orgUnitId = rows[0]!.id;
          created = true;
        }
        // 1:1 course row on org_unit_id.
        const courseRows = await db.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO course (tenant_id, org_unit_id, title)
             VALUES ($1::uuid, $2::uuid, $3)
           ON CONFLICT (org_unit_id)
             DO UPDATE SET title = EXCLUDED.title
           RETURNING id`,
          ctx.tenantId,
          orgUnitId,
          input.title,
        );
        const courseId = courseRows[0]!.id;
        await recordIdMapTx(db, ctx.tenantId, "class", input.sourcedId, orgUnitId);
        await recordIdMapTx(db, ctx.tenantId, "course", input.sourcedId, courseId);
        return { internalId: orgUnitId, courseId, created };
      });
    },

    async upsertEnrollment(
      ctx,
      input: EnrollmentUpsertInput,
    ): Promise<UpsertResult> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<{ id: string; inserted: boolean }[]>(
          `INSERT INTO enrollment (tenant_id, user_id, org_unit_id, role_id, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)
           ON CONFLICT (user_id, org_unit_id)
             DO UPDATE SET role_id = EXCLUDED.role_id, status = EXCLUDED.status
           RETURNING id, (xmax = 0) AS inserted`,
          ctx.tenantId,
          input.userInternalId,
          input.orgUnitInternalId,
          input.roleId,
          input.status,
        );
        const internalId = rows[0]!.id;
        const created = rows[0]!.inserted === true;
        await recordIdMapTx(db, ctx.tenantId, "enrollment", input.sourcedId, internalId);
        return { internalId, created };
      });
    },

    async resolveRoleId(ctx, roleName) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM role WHERE name = $1 LIMIT 1`,
          roleName,
        );
        return rows[0]?.id ?? null;
      });
    },
  };
}
