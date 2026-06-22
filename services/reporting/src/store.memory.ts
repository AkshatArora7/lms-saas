import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  BUILTIN_DEFINITIONS,
  type CreateRunInput,
  type ReportDefinition,
  type ReportRun,
  type ReportStore,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface DefinitionRow extends ReportDefinition {
  tenantId: string;
}

interface RunRow extends ReportRun {
  tenantId: string;
}

/**
 * In-memory ReportStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `REPORTING_STORE=memory`. The built-in definitions are seeded
 * lazily per tenant on first access, so every tenant sees its own catalog.
 */
export class MemoryReportStore implements ReportStore {
  private definitions: DefinitionRow[] = [];
  private runs: RunRow[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Idempotently seed the built-in definitions for a tenant. */
  private ensureDefinitions(tenantId: string): void {
    for (const def of BUILTIN_DEFINITIONS) {
      const exists = this.definitions.some(
        (d) => d.tenantId === tenantId && d.key === def.key,
      );
      if (!exists) {
        this.definitions.push({
          id: this.generateId(),
          tenantId,
          key: def.key,
          name: def.name,
          description: def.description,
          paramsSchema: def.paramsSchema,
          createdAt: this.now().toISOString(),
        });
      }
    }
  }

  async listDefinitions(ctx: TenantContext): Promise<ReportDefinition[]> {
    this.ensureDefinitions(ctx.tenantId);
    return this.definitions
      .filter((d) => d.tenantId === ctx.tenantId)
      .map((d) => this.toDefinition(d));
  }

  async getDefinitionByKey(
    ctx: TenantContext,
    key: string,
  ): Promise<ReportDefinition | null> {
    this.ensureDefinitions(ctx.tenantId);
    const row = this.definitions.find(
      (d) => d.tenantId === ctx.tenantId && d.key === key,
    );
    return row ? this.toDefinition(row) : null;
  }

  async createRun(
    ctx: TenantContext,
    input: CreateRunInput,
  ): Promise<ReportRun> {
    const row: RunRow = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      definitionId: input.definitionId,
      definitionKey: input.definitionKey,
      requestedBy: input.requestedBy,
      status: input.status,
      params: input.params,
      result: input.result,
      rowCount: input.rowCount,
      error: input.error,
      createdAt: this.now().toISOString(),
      completedAt: input.completedAt,
    };
    this.runs.push(row);
    return this.toRun(row);
  }

  async getRun(ctx: TenantContext, id: string): Promise<ReportRun | null> {
    const row = this.runs.find(
      (r) => r.id === id && r.tenantId === ctx.tenantId,
    );
    return row ? this.toRun(row) : null;
  }

  async listRuns(ctx: TenantContext): Promise<ReportRun[]> {
    // Runs are pushed in creation order; reverse for a deterministic
    // newest-first listing (avoids timestamp ties within the same ms).
    return this.runs
      .filter((r) => r.tenantId === ctx.tenantId)
      .map((r) => this.toRun(r))
      .reverse();
  }

  private toDefinition(row: DefinitionRow): ReportDefinition {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      paramsSchema: row.paramsSchema,
      createdAt: row.createdAt,
    };
  }

  private toRun(row: RunRow): ReportRun {
    return {
      id: row.id,
      definitionId: row.definitionId,
      definitionKey: row.definitionKey,
      requestedBy: row.requestedBy,
      status: row.status,
      params: row.params,
      result: row.result,
      rowCount: row.rowCount,
      error: row.error,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  }
}

/** Build a MemoryReportStore (built-ins seed lazily on first tenant access). */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): MemoryReportStore {
  return new MemoryReportStore(generateId, now);
}
