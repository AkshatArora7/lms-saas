import { controlPlane } from "@lms/db";

import type {
  SagaRun,
  SagaStateStore,
  SagaStatus,
  SagaStep,
  StartRunInput,
  StepPatch,
} from "./silo.saga.js";

interface SagaRow {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  status: SagaStatus;
  project_id: string | null;
  branch_id: string | null;
  database_ref: string | null;
  prev_tier: string | null;
  prev_database_ref: string | null;
  completed_steps: string[] | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

const SELECT_COLUMNS = `id, tenant_id, idempotency_key, status, project_id,
  branch_id, database_ref, prev_tier, prev_database_ref, completed_steps, error,
  created_at, updated_at, started_at, finished_at`;

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRun(row: SagaRow): SagaRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    projectId: row.project_id ?? null,
    branchId: row.branch_id ?? null,
    databaseRef: row.database_ref ?? null,
    prevTier: row.prev_tier ?? null,
    prevDatabaseRef: row.prev_database_ref ?? null,
    completedSteps: (row.completed_steps ?? []) as SagaStep[],
    error: row.error ?? null,
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? "",
    startedAt: asIso(row.started_at),
    finishedAt: asIso(row.finished_at),
  };
}

/** Statuses that close a run (set finished_at). */
const TERMINAL: ReadonlySet<SagaStatus> = new Set([
  "completed",
  "rolled_back",
  "compensation_failed",
]);

/**
 * Control-plane SagaStateStore for the silo-promotion saga. The
 * `tenant_silo_migration` table is control-plane (NOT RLS, precedent
 * `tenant_admin_delegation`), so every statement runs through `controlPlane()`,
 * never `withTenant`. The control-plane client is resolved LAZILY so building
 * the app never requires a live DB (tests inject the memory store).
 */
export function createPrismaSagaStateStore(): SagaStateStore {
  const cp = (): Db => controlPlane() as unknown as Db;

  return {
    async startRun(input: StartRunInput): Promise<SagaRun> {
      // ON CONFLICT (idempotency_key) returns the existing run so a concurrent
      // re-POST never opens a second saga — mirrors the UNIQUE constraint.
      const rows = await cp().$queryRawUnsafe<SagaRow[]>(
        `INSERT INTO tenant_silo_migration
           (tenant_id, idempotency_key, status, prev_tier, prev_database_ref,
            started_at)
         VALUES ($1::uuid, $2, 'pending', $3, $4, now())
         ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING ${SELECT_COLUMNS}`,
        input.tenantId,
        input.idempotencyKey,
        input.prevTier,
        input.prevDatabaseRef,
      );
      return toRun(rows[0]!);
    },

    async markStep(id: string, patch: StepPatch): Promise<SagaRun | null> {
      const rows = await cp().$queryRawUnsafe<SagaRow[]>(
        `UPDATE tenant_silo_migration
            SET status = $2,
                completed_steps = CASE
                  WHEN $3::text IS NULL THEN completed_steps
                  WHEN $3 = ANY(completed_steps) THEN completed_steps
                  ELSE array_append(completed_steps, $3)
                END,
                project_id   = COALESCE($4, project_id),
                branch_id    = COALESCE($5, branch_id),
                database_ref = COALESCE($6, database_ref),
                updated_at   = now()
          WHERE id = $1::uuid
        RETURNING ${SELECT_COLUMNS}`,
        id,
        patch.status,
        patch.completedStep ?? null,
        patch.projectId ?? null,
        patch.branchId ?? null,
        patch.databaseRef ?? null,
      );
      return rows[0] ? toRun(rows[0]) : null;
    },

    async markStatus(
      id: string,
      status: SagaStatus,
      opts?: { error?: string | null; finished?: boolean },
    ): Promise<SagaRun | null> {
      const finished = opts?.finished || TERMINAL.has(status);
      const rows = await cp().$queryRawUnsafe<SagaRow[]>(
        `UPDATE tenant_silo_migration
            SET status = $2,
                error = COALESCE($3, error),
                finished_at = CASE WHEN $4::boolean THEN now() ELSE finished_at END,
                updated_at = now()
          WHERE id = $1::uuid
        RETURNING ${SELECT_COLUMNS}`,
        id,
        status,
        opts?.error ?? null,
        finished,
      );
      return rows[0] ? toRun(rows[0]) : null;
    },

    async getRun(id: string): Promise<SagaRun | null> {
      const rows = await cp().$queryRawUnsafe<SagaRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant_silo_migration
          WHERE id = $1::uuid LIMIT 1`,
        id,
      );
      return rows[0] ? toRun(rows[0]) : null;
    },

    async getRunByKey(idempotencyKey: string): Promise<SagaRun | null> {
      const rows = await cp().$queryRawUnsafe<SagaRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant_silo_migration
          WHERE idempotency_key = $1 LIMIT 1`,
        idempotencyKey,
      );
      return rows[0] ? toRun(rows[0]) : null;
    },

    async getLatestRunByTenant(tenantId: string): Promise<SagaRun | null> {
      const rows = await cp().$queryRawUnsafe<SagaRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM tenant_silo_migration
          WHERE tenant_id = $1::uuid
          ORDER BY created_at DESC LIMIT 1`,
        tenantId,
      );
      return rows[0] ? toRun(rows[0]) : null;
    },
  };
}
