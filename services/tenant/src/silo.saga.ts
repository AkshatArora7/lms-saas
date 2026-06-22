/**
 * PURE silo-promotion saga engine (issue #3).
 *
 * Promotes a tenant pool -> silo across five ordered steps, each with a forward
 * action and a compensation:
 *
 *   1 provision  createProject + createBranch -> SiloTarget   comp: deprovision(target)
 *   2 migrate    runMigrations(target)                        comp: (covered by step-1 deprovision)
 *   3 copy       copyTenantData(tenantId, target)             comp: (covered by step-1 deprovision)
 *   4 repoint    store.setDatabaseRef(id, target.databaseRef) comp: store.setDatabaseRef(id, prevRef)
 *   5 flip       store.setTier(id, 'silo') (+ status active)  comp: store.setTier(id, prevTier) (+ revert status)
 *
 * On ANY step failure the engine runs the compensations of all COMPLETED steps
 * in REVERSE order, then marks the run `rolled_back` — or `compensation_failed`
 * if a compensation itself throws (surfaced for manual intervention, never
 * silently swallowed). Cutover orders repoint (4) BEFORE flip (5) so a partial
 * run never leaves a silo-tier tenant whose database_ref is null; reverse
 * compensation therefore unwinds the catalog first (cheap, local) and infra last.
 *
 * The engine is a PURE function of its injected deps (input, port, store,
 * sagaStore, clock): all I/O is behind those interfaces, so it is fully testable
 * with a FakeSiloPort + memory stores — no Postgres, no network.
 */
import {
  SiloProvisioningError,
  type SiloProvisioningPort,
  type SiloTarget,
} from "./silo.js";
import type { TenantStore } from "./store.js";

/** The saga's ordered step keys, in forward order. */
export const SAGA_STEPS = [
  "provision",
  "migrate",
  "copy",
  "repoint",
  "flip",
] as const;
export type SagaStep = (typeof SAGA_STEPS)[number];

/** Terminal + in-flight statuses persisted on a run row (mirrors the CHECK in schema.sql). */
export type SagaStatus =
  | "pending"
  | "provisioning"
  | "migrating"
  | "copying"
  | "repointing"
  | "flipping"
  | "completed"
  | "rolled_back"
  | "compensation_failed";

/** A persisted saga run (one row of `tenant_silo_migration`). */
export interface SagaRun {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  status: SagaStatus;
  projectId: string | null;
  branchId: string | null;
  databaseRef: string | null;
  prevTier: string | null;
  prevDatabaseRef: string | null;
  completedSteps: SagaStep[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** What `startRun` needs to open a new run row (prev-values captured for compensation). */
export interface StartRunInput {
  tenantId: string;
  idempotencyKey: string;
  prevTier: string;
  prevDatabaseRef: string | null;
}

/** Per-step progress patch persisted by `markStep`. */
export interface StepPatch {
  status: SagaStatus;
  completedStep?: SagaStep;
  projectId?: string | null;
  branchId?: string | null;
  databaseRef?: string | null;
}

/**
 * Durable saga-state boundary. Control-plane Postgres impl in
 * `silo.saga.prisma.ts`; array impl in `silo.saga.memory.ts`. Injectable so the
 * engine is testable without a DB.
 */
export interface SagaStateStore {
  /** Open a new run (status 'pending', started_at = now). */
  startRun(input: StartRunInput): Promise<SagaRun>;
  /** Append a completed step and/or advance status + persist target fields. */
  markStep(id: string, patch: StepPatch): Promise<SagaRun | null>;
  /** Set a terminal/in-flight status; on terminal sets finished_at + error. */
  markStatus(
    id: string,
    status: SagaStatus,
    opts?: { error?: string | null; finished?: boolean },
  ): Promise<SagaRun | null>;
  getRun(id: string): Promise<SagaRun | null>;
  /** Idempotency lookup: existing run for this key, or null. */
  getRunByKey(idempotencyKey: string): Promise<SagaRun | null>;
  /** Most-recent run for a tenant (status endpoint), or null if none. */
  getLatestRunByTenant(tenantId: string): Promise<SagaRun | null>;
}

/** Input to a single saga execution. */
export interface PromoteToSiloInput {
  tenantId: string;
  idempotencyKey: string;
  region: string;
}

export interface SagaDeps {
  port: SiloProvisioningPort;
  store: TenantStore;
  sagaStore: SagaStateStore;
  /** Injectable clock (unused by the engine directly; stores own timestamps). */
  clock?: () => Date;
}

/** Outcome of a saga run. `failedStep` is set on rollback. */
export interface SagaOutcome {
  run: SagaRun;
  /** Convenience flag: true iff run.status === 'completed'. */
  ok: boolean;
  failedStep?: SagaStep;
}

/** Per-step status the run carries while that step is in flight. */
const IN_FLIGHT: Record<SagaStep, SagaStatus> = {
  provision: "provisioning",
  migrate: "migrating",
  copy: "copying",
  repoint: "repointing",
  flip: "flipping",
};

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Run the silo-promotion saga for one tenant. Idempotent on `idempotencyKey`:
 * if a run already exists for the key it is returned as-is (no second saga).
 *
 * PRECONDITIONS (validated by the caller/route, asserted here defensively):
 * the tenant exists and is currently tier 'pool'. The engine captures
 * prev-tier/prev-database_ref at start so compensations revert exactly.
 */
export async function promoteToSilo(
  input: PromoteToSiloInput,
  deps: SagaDeps,
): Promise<SagaOutcome> {
  const { port, store, sagaStore } = deps;

  // Idempotency: a re-POST with the same key returns the existing run.
  const existing = await sagaStore.getRunByKey(input.idempotencyKey);
  if (existing) {
    return { run: existing, ok: existing.status === "completed" };
  }

  const tenant = await store.getTenant(input.tenantId);
  if (!tenant) {
    // Defensive: the route validates existence first. Open no run.
    throw new Error("tenant_not_found");
  }

  const run = await sagaStore.startRun({
    tenantId: input.tenantId,
    idempotencyKey: input.idempotencyKey,
    prevTier: tenant.tier,
    prevDatabaseRef: tenant.databaseRef,
  });

  // Completed steps in execution order; compensations run in reverse.
  const completed: SagaStep[] = [];
  // Mutated as provisioning yields coordinates.
  let target: SiloTarget | null = null;
  // The exact prior tier/status captured at run start, for compensations.
  const prevTier = tenant.tier;
  const wasProvisioning = tenant.status === "provisioning";

  /** Run all completed steps' compensations in REVERSE order. */
  async function compensate(): Promise<SagaStatus> {
    for (let i = completed.length - 1; i >= 0; i -= 1) {
      const step = completed[i]!;
      try {
        switch (step) {
          case "flip":
            // Revert to the exact tier captured at run start (pool, given the
            // route only promotes pool tenants). If the forward path activated a
            // 'provisioning' tenant, revert that too.
            await store.setTier(input.tenantId, prevTier);
            if (wasProvisioning) {
              await store.setStatus(input.tenantId, "provisioning");
            }
            break;
          case "repoint":
            await store.setDatabaseRef(input.tenantId, run.prevDatabaseRef);
            break;
          case "copy":
          case "migrate":
            // Data + migrations live in the branch torn down by the provision
            // compensation; no independent compensation.
            break;
          case "provision":
            await port.deprovision(input.tenantId, target ?? {});
            break;
        }
      } catch (compErr) {
        await sagaStore.markStatus(run.id, "compensation_failed", {
          error: `compensation_failed at ${step}: ${messageOf(compErr)}`,
          finished: true,
        });
        return "compensation_failed";
      }
    }
    return "rolled_back";
  }

  let currentStep: SagaStep = "provision";
  try {
    // 1) provision — createProject + createBranch -> SiloTarget.
    currentStep = "provision";
    await sagaStore.markStatus(run.id, IN_FLIGHT.provision);
    const { projectId } = await port.createProject(input.tenantId, input.region);
    const { branchId, databaseRef } = await port.createBranch(
      input.tenantId,
      projectId,
    );
    target = { projectId, branchId, databaseRef };
    completed.push("provision");
    await sagaStore.markStep(run.id, {
      status: IN_FLIGHT.provision,
      completedStep: "provision",
      projectId,
      branchId,
      databaseRef,
    });

    // 2) migrate — schema.sql + rls.sql onto the new branch.
    currentStep = "migrate";
    await sagaStore.markStatus(run.id, IN_FLIGHT.migrate);
    await port.runMigrations(target);
    completed.push("migrate");
    await sagaStore.markStep(run.id, {
      status: IN_FLIGHT.migrate,
      completedStep: "migrate",
    });

    // 3) copy — bulk-copy the tenant's rows pool -> silo.
    currentStep = "copy";
    await sagaStore.markStatus(run.id, IN_FLIGHT.copy);
    await port.copyTenantData(input.tenantId, target);
    completed.push("copy");
    await sagaStore.markStep(run.id, {
      status: IN_FLIGHT.copy,
      completedStep: "copy",
    });

    // 4) repoint — catalog database_ref BEFORE the tier flip.
    currentStep = "repoint";
    await sagaStore.markStatus(run.id, IN_FLIGHT.repoint);
    await store.setDatabaseRef(input.tenantId, target.databaseRef);
    completed.push("repoint");
    await sagaStore.markStep(run.id, {
      status: IN_FLIGHT.repoint,
      completedStep: "repoint",
    });

    // 5) flip — tier -> silo (+ activate if it was still provisioning).
    currentStep = "flip";
    await sagaStore.markStatus(run.id, IN_FLIGHT.flip);
    await store.setTier(input.tenantId, "silo");
    if (wasProvisioning) {
      await store.setStatus(input.tenantId, "active");
    }
    completed.push("flip");
    await sagaStore.markStep(run.id, {
      status: IN_FLIGHT.flip,
      completedStep: "flip",
    });

    const done = await sagaStore.markStatus(run.id, "completed", {
      finished: true,
    });
    return { run: done ?? run, ok: true };
  } catch (err) {
    // Record the failing step's error, then roll back completed steps.
    const failMessage =
      err instanceof SiloProvisioningError
        ? `${err.step}: ${err.message}`
        : `${currentStep}: ${messageOf(err)}`;
    await sagaStore.markStatus(run.id, IN_FLIGHT[currentStep], {
      error: failMessage,
    });
    const terminal = await compensate();
    const finalRun =
      terminal === "compensation_failed"
        ? await sagaStore.getRun(run.id)
        : await sagaStore.markStatus(run.id, "rolled_back", {
            error: failMessage,
            finished: true,
          });
    return {
      run: finalRun ?? run,
      ok: false,
      failedStep: currentStep,
    };
  }
}
