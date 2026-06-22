/**
 * Silo provisioning PORT for the tenant control plane (issue #3).
 *
 * Promoting a tenant from the shared `pool` to its own dedicated `silo` DB is a
 * multi-step SAGA (provision -> migrate -> copy -> repoint -> flip) with
 * compensations. The infra-facing work (stand up a Neon project/branch, run
 * migrations, bulk-copy the tenant's rows, tear it back down) sits behind this
 * injectable port — exactly like the SIS {@link OneRosterClient} and the tenant
 * offboarding ports — so the saga engine is hermetic/testable with a fake and no
 * network. Production wires {@link createNeonSiloPort} (see `silo.neon.ts`).
 *
 * This file declares ONLY the contract + record shapes + the error type; it
 * performs no I/O. The PURE saga engine lives in `silo.saga.ts`.
 */

/** The provisioned dedicated-DB coordinates. All fields are OPAQUE refs — never a raw DSN. */
export interface SiloTarget {
  /** Opaque Neon project ref. */
  projectId: string;
  /** Opaque Neon branch ref. */
  branchId: string;
  /** Opaque secret-store reference to the silo DSN (resolved out of band). */
  databaseRef: string;
}

/**
 * Infra port the silo-promotion saga depends on. Production = Neon REST adapter;
 * tests inject a fake. Every method must be IDEMPOTENT so a retried/rolled-back
 * saga does not double-provision or fail on re-deprovision.
 */
export interface SiloProvisioningPort {
  /** Stand up the dedicated project. Idempotent on (tenantId) — re-call returns the same project. */
  createProject(tenantId: string, region: string): Promise<{ projectId: string }>;
  /** Create the primary branch + its DSN secret-store ref. Idempotent on (tenantId, projectId). */
  createBranch(
    tenantId: string,
    projectId: string,
  ): Promise<{ branchId: string; databaseRef: string }>;
  /** Apply schema.sql + rls.sql to the new branch so it is schema-identical to pool. */
  runMigrations(target: SiloTarget): Promise<void>;
  /** Bulk-copy this tenant's rows pool->silo for every tenant-scoped table. */
  copyTenantData(
    tenantId: string,
    target: SiloTarget,
  ): Promise<{ tables: number; rows: number }>;
  /** Compensation: tear down infra created by createProject/createBranch. Idempotent. */
  deprovision(tenantId: string, target: Partial<SiloTarget>): Promise<void>;
}

/**
 * Thrown by a port method when an infra step fails. The saga catches it, runs
 * the completed steps' compensations in reverse, and records `error` on the run.
 * `step` is the saga step that was executing (provision|migrate|copy).
 */
export class SiloProvisioningError extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = "SiloProvisioningError";
  }
}
