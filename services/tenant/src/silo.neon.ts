/**
 * PROD silo provisioning adapter — Neon REST over an injectable `fetchImpl`
 * (mirrors `offboarding.http.ts`).
 *
 * STATUS: DOCUMENTED STUB. The real implementation must:
 *   - createProject  -> Neon `POST /projects` (region-pinned), return project id;
 *   - createBranch   -> Neon `POST /projects/{id}/branches` + create a role/db,
 *                       then WRITE the resulting DSN to the secret store and
 *                       return only the OPAQUE secret-store ref (NEVER the DSN);
 *   - runMigrations  -> apply `database/schema.sql` + `database/policies/rls.sql`
 *                       to the new branch so silo is schema-identical to pool;
 *   - copyTenantData -> bulk-copy this tenant's rows for every tenant-scoped
 *                       table, preserving per-row `tenant_id`;
 *   - deprovision    -> delete the branch/project (idempotent).
 *
 * Until that follow-up lands, every method throws `not_implemented` so a
 * mis-wired prod call fails loudly rather than silently half-promoting a tenant.
 * The saga engine + catalog repoint + rollback ship now and are fully covered by
 * tests via a FakeSiloPort; this adapter is swapped in when the Neon API +
 * secret-store integration is built. See handshake §6 (follow-up).
 */
import {
  SiloProvisioningError,
  type SiloProvisioningPort,
  type SiloTarget,
} from "./silo.js";

export interface NeonSiloOptions {
  /** Neon API base URL, e.g. https://console.neon.tech/api/v2. */
  apiUrl: string;
  /** Neon API key (read from the secret store in prod wiring, not hard-coded). */
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. Unused while stubbed. */
  fetchImpl?: typeof fetch;
}

const NOT_IMPLEMENTED =
  "Neon silo provisioning is not yet implemented (follow-up to issue #3); " +
  "wire the real Neon REST + secret-store adapter before enabling prod silo promotion.";

/**
 * Construct the prod Neon adapter. Currently a stub: it captures its options but
 * every port method throws `SiloProvisioningError('not_implemented', …)`.
 */
export function createNeonSiloPort(opts: NeonSiloOptions): SiloProvisioningPort {
  // Retain config so the follow-up impl has it; `void` keeps it referenced
  // without tripping noUnusedLocals while the methods are stubbed.
  const base = opts.apiUrl.replace(/\/$/, "");
  void base;
  void opts.apiKey;
  void opts.fetchImpl;

  function notImplemented(step: string): never {
    throw new SiloProvisioningError(step, NOT_IMPLEMENTED);
  }

  return {
    async createProject(_tenantId: string, _region: string) {
      return notImplemented("provision");
    },
    async createBranch(_tenantId: string, _projectId: string) {
      return notImplemented("provision");
    },
    async runMigrations(_target: SiloTarget) {
      return notImplemented("migrate");
    },
    async copyTenantData(_tenantId: string, _target: SiloTarget) {
      return notImplemented("copy");
    },
    async deprovision(_tenantId: string, _target: Partial<SiloTarget>) {
      // Idempotent teardown; the stub no-ops so a rollback path in a
      // mis-wired prod call does not itself throw and mask the real failure.
      return;
    },
  };
}
