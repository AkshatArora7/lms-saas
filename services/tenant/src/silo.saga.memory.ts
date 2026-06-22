import { randomUUID } from "node:crypto";

import type {
  SagaRun,
  SagaStateStore,
  SagaStatus,
  SagaStep,
  StartRunInput,
  StepPatch,
} from "./silo.saga.js";

/** Statuses that close a run (set finished_at). */
const TERMINAL: ReadonlySet<SagaStatus> = new Set([
  "completed",
  "rolled_back",
  "compensation_failed",
]);

/**
 * In-memory SagaStateStore for tests and `TENANT_STORE=memory`. Mirrors the
 * control-plane `tenant_silo_migration` table as an array (the table is NOT
 * RLS-scoped, so there is no tenant filtering — see store.ts). Idempotency is
 * enforced on `idempotencyKey` exactly as the table's UNIQUE constraint.
 */
export class MemorySagaStateStore implements SagaStateStore {
  private runs: SagaRun[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async startRun(input: StartRunInput): Promise<SagaRun> {
    const existing = this.runs.find(
      (r) => r.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return existing;
    const ts = this.now().toISOString();
    const run: SagaRun = {
      id: this.generateId(),
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      projectId: null,
      branchId: null,
      databaseRef: null,
      prevTier: input.prevTier,
      prevDatabaseRef: input.prevDatabaseRef,
      completedSteps: [],
      error: null,
      createdAt: ts,
      updatedAt: ts,
      startedAt: ts,
      finishedAt: null,
    };
    this.runs.push(run);
    return run;
  }

  async markStep(id: string, patch: StepPatch): Promise<SagaRun | null> {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return null;
    run.status = patch.status;
    if (patch.completedStep && !run.completedSteps.includes(patch.completedStep)) {
      run.completedSteps.push(patch.completedStep);
    }
    if (patch.projectId !== undefined) run.projectId = patch.projectId;
    if (patch.branchId !== undefined) run.branchId = patch.branchId;
    if (patch.databaseRef !== undefined) run.databaseRef = patch.databaseRef;
    run.updatedAt = this.now().toISOString();
    return run;
  }

  async markStatus(
    id: string,
    status: SagaStatus,
    opts?: { error?: string | null; finished?: boolean },
  ): Promise<SagaRun | null> {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return null;
    run.status = status;
    if (opts?.error !== undefined) run.error = opts.error;
    const ts = this.now().toISOString();
    run.updatedAt = ts;
    if (opts?.finished || TERMINAL.has(status)) run.finishedAt = ts;
    return run;
  }

  async getRun(id: string): Promise<SagaRun | null> {
    return this.runs.find((r) => r.id === id) ?? null;
  }

  async getRunByKey(idempotencyKey: string): Promise<SagaRun | null> {
    return this.runs.find((r) => r.idempotencyKey === idempotencyKey) ?? null;
  }

  async getLatestRunByTenant(tenantId: string): Promise<SagaRun | null> {
    const forTenant = this.runs.filter((r) => r.tenantId === tenantId);
    return forTenant.length > 0 ? forTenant[forTenant.length - 1]! : null;
  }

  /** Test accessor: all recorded steps for a run, in order. */
  stepsOf(id: string): SagaStep[] {
    return this.runs.find((r) => r.id === id)?.completedSteps ?? [];
  }
}
