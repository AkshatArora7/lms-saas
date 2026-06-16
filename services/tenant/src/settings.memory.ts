import type { TenantContext } from "@lms/types";

import type { SettingRecord, SettingsStore } from "./settings.js";

/**
 * In-memory governance settings store. Keyed by tenant id to emulate the
 * RLS isolation Postgres enforces on `tenant_setting`. Used by the test suite
 * and `TENANT_STORE=memory`.
 */
export class MemorySettingsStore implements SettingsStore {
  private readonly byTenant = new Map<string, Map<string, unknown>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  private tenantMap(tenantId: string): Map<string, unknown> {
    let map = this.byTenant.get(tenantId);
    if (!map) {
      map = new Map();
      this.byTenant.set(tenantId, map);
    }
    return map;
  }

  async putSetting(
    ctx: TenantContext,
    key: string,
    value: unknown,
  ): Promise<SettingRecord> {
    this.tenantMap(ctx.tenantId).set(key, value);
    return { key, value, updatedAt: this.now().toISOString() };
  }

  async listStored(ctx: TenantContext): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of this.tenantMap(ctx.tenantId)) out[key] = value;
    return out;
  }
}
