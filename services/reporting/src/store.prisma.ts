import { withTenant, type PrismaClient } from "@lms/db";

import {
  BUILTIN_DEFINITIONS,
  type CreateRunInput,
  type ReportDefinition,
  type ReportRun,
  type ReportStore,
} from "./store.js";

interface DefinitionRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  params_schema: unknown;
  created_at: Date | string;
}

interface RunRow {
  id: string;
  definition_id: string;
  definition_key: string;
  requested_by: string | null;
  status: ReportRun["status"];
  params: unknown;
  result: unknown;
  row_count: number | string | null;
  error: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: Date | string | null): string | null {
  return value == null ? null : iso(value);
}

/** Parse a jsonb column that may arrive as an object or a JSON string. */
function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Parse a nullable jsonb result column (object/array/string passthrough). */
function parseResult(value: unknown): unknown | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function toDefinition(row: DefinitionRow): ReportDefinition {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    paramsSchema: parseJson(row.params_schema),
    createdAt: iso(row.created_at),
  };
}

function toRun(row: RunRow): ReportRun {
  return {
    id: row.id,
    definitionId: row.definition_id,
    definitionKey: row.definition_key,
    requestedBy: row.requested_by,
    status: row.status,
    params: parseJson(row.params),
    result: parseResult(row.result),
    rowCount: row.row_count == null ? null : Number(row.row_count),
    error: row.error,
    createdAt: iso(row.created_at),
    completedAt: isoOrNull(row.completed_at),
  };
}

/**
 * Idempotently seed the tenant's built-in definitions. Uses ON CONFLICT against
 * the UNIQUE (tenant_id, key) constraint so repeated calls are no-ops. Runs
 * inside the caller's RLS-scoped transaction (`db` from withTenant).
 */
async function ensureDefinitions(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  for (const def of BUILTIN_DEFINITIONS) {
    await db.$executeRawUnsafe(
      `INSERT INTO report_definition (tenant_id, key, name, description, params_schema)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      tenantId,
      def.key,
      def.name,
      def.description,
      JSON.stringify(def.paramsSchema),
    );
  }
}

/**
 * Postgres-backed reporting store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — definitions and runs can never leak across tenants.
 * Per the uuid=text rule (#267), uuid params are cast `$n::uuid` and jsonb
 * params are passed `$n::jsonb` via JSON.stringify.
 */
export function createPrismaStore(): ReportStore {
  return {
    async listDefinitions(ctx): Promise<ReportDefinition[]> {
      return withTenant(ctx, async (db) => {
        await ensureDefinitions(db, ctx.tenantId);
        const rows = await db.$queryRawUnsafe<DefinitionRow[]>(
          `SELECT id, key, name, description, params_schema, created_at
             FROM report_definition
            ORDER BY key`,
        );
        return rows.map(toDefinition);
      });
    },

    async getDefinitionByKey(ctx, key): Promise<ReportDefinition | null> {
      return withTenant(ctx, async (db) => {
        await ensureDefinitions(db, ctx.tenantId);
        const rows = await db.$queryRawUnsafe<DefinitionRow[]>(
          `SELECT id, key, name, description, params_schema, created_at
             FROM report_definition
            WHERE key = $1
            LIMIT 1`,
          key,
        );
        return rows[0] ? toDefinition(rows[0]) : null;
      });
    },

    async createRun(ctx, input: CreateRunInput): Promise<ReportRun> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<RunRow[]>(
          `INSERT INTO report_run
             (tenant_id, definition_id, definition_key, requested_by,
              status, params, result, row_count, error, completed_at)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid,
                   $5, $6::jsonb, $7::jsonb, $8, $9, $10)
           RETURNING id, definition_id, definition_key, requested_by, status,
                     params, result, row_count, error, created_at, completed_at`,
          ctx.tenantId,
          input.definitionId,
          input.definitionKey,
          input.requestedBy,
          input.status,
          JSON.stringify(input.params),
          input.result == null ? null : JSON.stringify(input.result),
          input.rowCount,
          input.error,
          input.completedAt,
        );
        return toRun(rows[0]!);
      });
    },

    async getRun(ctx, id): Promise<ReportRun | null> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<RunRow[]>(
          `SELECT id, definition_id, definition_key, requested_by, status,
                  params, result, row_count, error, created_at, completed_at
             FROM report_run
            WHERE id = $1::uuid
            LIMIT 1`,
          id,
        );
        return rows[0] ? toRun(rows[0]) : null;
      });
    },

    async listRuns(ctx): Promise<ReportRun[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<RunRow[]>(
          `SELECT id, definition_id, definition_key, requested_by, status,
                  params, result, row_count, error, created_at, completed_at
             FROM report_run
            ORDER BY created_at DESC`,
        );
        return rows.map(toRun);
      });
    },
  };
}
