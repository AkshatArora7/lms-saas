import { withTenant } from "@lms/db";
import type { TenantContext } from "@lms/types";

import type { SettingRecord, SettingsStore } from "./settings.js";

interface SettingRow {
  key: string;
  value: unknown;
  updated_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
}

/**
 * Postgres-backed governance settings store. Runs through `withTenant`, so
 * `tenant_setting` rows are RLS-scoped to the tenant in the request path — one
 * tenant can neither read nor write another's policy. uuid params are cast.
 */
export function createPrismaSettingsStore(): SettingsStore {
  return {
    async putSetting(
      ctx: TenantContext,
      key: string,
      value: unknown,
    ): Promise<SettingRecord> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<SettingRow[]>(
          `INSERT INTO tenant_setting (tenant_id, key, value)
           VALUES ($1::uuid, $2, $3::jsonb)
           ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
           RETURNING key, value, updated_at`,
          ctx.tenantId,
          key,
          JSON.stringify(value),
        );
        const row = rows[0]!;
        return {
          key: row.key,
          value: row.value,
          updatedAt:
            row.updated_at instanceof Date
              ? row.updated_at.toISOString()
              : String(row.updated_at),
        };
      });
    },

    async listStored(ctx: TenantContext): Promise<Record<string, unknown>> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<SettingRow[]>(
          `SELECT key, value, updated_at FROM tenant_setting`,
        );
        const out: Record<string, unknown> = {};
        for (const row of rows) out[row.key] = row.value;
        return out;
      });
    },
  };
}
