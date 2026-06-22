import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  SiloProvisioningError,
  type SiloProvisioningPort,
  type SiloTarget,
} from "./silo.js";
import { MemorySagaStateStore } from "./silo.saga.memory.js";
import { SAGA_STEPS, type SagaStep } from "./silo.saga.js";
import { MemoryTenantStore } from "./store.memory.js";
import { subdomainFor, type TenantRecord } from "./store.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";

function poolTenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: TENANT_ID,
    slug: "demo",
    name: "Demo Academy",
    kind: "standalone",
    parentId: null,
    tier: "pool",
    status: "active",
    region: "us-east",
    planId: null,
    databaseRef: null,
    subdomain: subdomainFor("demo"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Fake silo provisioning port: an in-memory project/branch registry that records
 * every call, with a `failAt` knob to drive each compensation path. Mirrors the
 * offboarding test fakes (offboarding.test.ts:28-65).
 */
interface FakeSiloPort extends SiloProvisioningPort {
  calls: string[];
  /** Branches still provisioned (cleared by deprovision) — proves teardown ran. */
  liveBranches: Set<string>;
}

function fakePort(opts: { failAt?: SagaStep } = {}): FakeSiloPort {
  const calls: string[] = [];
  const liveBranches = new Set<string>();
  function maybeFail(step: SagaStep): void {
    if (opts.failAt === step) {
      throw new SiloProvisioningError(step, `injected failure at ${step}`);
    }
  }
  return {
    calls,
    liveBranches,
    async createProject(tenantId) {
      calls.push("createProject");
      maybeFail("provision");
      return { projectId: `proj-${tenantId}` };
    },
    async createBranch(tenantId, projectId) {
      calls.push("createBranch");
      const branchId = `branch-${projectId}`;
      liveBranches.add(branchId);
      return { branchId, databaseRef: `secret://${tenantId}/dsn` };
    },
    async runMigrations(_target: SiloTarget) {
      calls.push("runMigrations");
      maybeFail("migrate");
    },
    async copyTenantData(_tenantId, _target) {
      calls.push("copyTenantData");
      maybeFail("copy");
      return { tables: 21, rows: 100 };
    },
    async deprovision(_tenantId, target) {
      calls.push("deprovision");
      if (target.branchId) liveBranches.delete(target.branchId);
    },
  };
}

/** A store whose setDatabaseRef OR setTier throws, to drive the repoint/flip failures. */
class ThrowingStore extends MemoryTenantStore {
  constructor(
    private readonly failOn: "repoint" | "flip",
    private readonly seedTenant: TenantRecord,
  ) {
    super();
    this.seed(seedTenant);
  }
  override async setDatabaseRef(id: string, ref: string | null) {
    if (this.failOn === "repoint") throw new Error("catalog repoint failed");
    return super.setDatabaseRef(id, ref);
  }
  override async setTier(id: string, tier: "pool" | "silo") {
    if (this.failOn === "flip") throw new Error("tier flip failed");
    return super.setTier(id, tier);
  }
}

function build(opts: {
  store?: MemoryTenantStore;
  port?: FakeSiloPort;
  sagaStore?: MemorySagaStateStore;
} = {}) {
  const store =
    opts.store ??
    (() => {
      const s = new MemoryTenantStore();
      s.seed(poolTenant());
      return s;
    })();
  const port = opts.port ?? fakePort();
  const sagaStore = opts.sagaStore ?? new MemorySagaStateStore();
  const app = buildApp({ config, store, siloPort: port, sagaStore });
  return { app, store, port, sagaStore };
}

describe("silo promotion saga (#3)", () => {
  it("happy path: all 5 steps complete, tenant ends silo with database_ref, run completed", async () => {
    const { app, store, port } = build();
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-happy", actorId: "super-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.migration.status).toBe("completed");
    expect(body.migration.completedSteps).toEqual([...SAGA_STEPS]);

    // The catalog now reflects a silo tenant with an opaque database_ref.
    const tenant = await store.getTenant(TENANT_ID);
    expect(tenant?.tier).toBe("silo");
    expect(tenant?.databaseRef).toBe(`secret://${TENANT_ID}/dsn`);
    // database_ref is an opaque secret-store ref, never a raw DSN.
    expect(tenant?.databaseRef).not.toContain("postgres://");
    // The branch stayed live (not torn down on success).
    expect(port.liveBranches.size).toBe(1);
  });

  it("provision failure → no infra remains, tenant stays pool, run rolled_back", async () => {
    const { app, store, port } = build({ port: fakePort({ failAt: "provision" }) });
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-prov" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.migration.status).toBe("rolled_back");
    expect(body.failedStep).toBe("provision");
    const tenant = await store.getTenant(TENANT_ID);
    expect(tenant?.tier).toBe("pool");
    expect(tenant?.databaseRef).toBeNull();
    // createProject threw before a branch existed.
    expect(port.liveBranches.size).toBe(0);
  });

  it("migrate failure → deprovision tears down infra, tenant stays pool", async () => {
    const { app, store, port } = build({ port: fakePort({ failAt: "migrate" }) });
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-mig" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().failedStep).toBe("migrate");
    expect(res.json().migration.status).toBe("rolled_back");
    // Reverse-order compensation ran deprovision after the branch was created.
    expect(port.calls).toContain("deprovision");
    expect(port.liveBranches.size).toBe(0);
    const tenant = await store.getTenant(TENANT_ID);
    expect(tenant?.tier).toBe("pool");
    expect(tenant?.databaseRef).toBeNull();
  });

  it("copy failure → deprovision tears down infra, tenant stays pool", async () => {
    const { app, store, port } = build({ port: fakePort({ failAt: "copy" }) });
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-copy" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().failedStep).toBe("copy");
    expect(port.liveBranches.size).toBe(0);
    const tenant = await store.getTenant(TENANT_ID);
    expect(tenant?.tier).toBe("pool");
    expect(tenant?.databaseRef).toBeNull();
  });

  it("repoint failure → compensations revert in reverse, tenant stays pool with prior ref", async () => {
    const store = new ThrowingStore("repoint", poolTenant());
    const port = fakePort();
    const sagaStore = new MemorySagaStateStore();
    const app = buildApp({ config, store, siloPort: port, sagaStore });
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-rep" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().failedStep).toBe("repoint");
    // provision/migrate/copy completed → deprovision must have run to undo infra.
    expect(port.calls).toContain("deprovision");
    expect(port.liveBranches.size).toBe(0);
    const tenant = await store.getTenant(TENANT_ID);
    expect(tenant?.tier).toBe("pool");
    expect(tenant?.databaseRef).toBeNull();
  });

  it("flip failure → repoint + provision compensations run in reverse, tenant restored to pool", async () => {
    const store = new ThrowingStore("flip", poolTenant());
    const port = fakePort();
    const sagaStore = new MemorySagaStateStore();
    const app = buildApp({ config, store, siloPort: port, sagaStore });
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-flip" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().failedStep).toBe("flip");
    // repoint had set database_ref; its compensation must revert it to null.
    const tenant = await store.getTenant(TENANT_ID);
    expect(tenant?.tier).toBe("pool");
    expect(tenant?.databaseRef).toBeNull();
    // And infra was torn down (provision compensation, run last in reverse).
    expect(port.calls).toContain("deprovision");
    expect(port.liveBranches.size).toBe(0);
  });

  it("idempotent retry: re-POST with same key returns the existing run, no second saga", async () => {
    const { app, port } = build();
    const first = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-idem" },
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().migration.id;
    const callsAfterFirst = port.calls.length;

    const second = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-idem" },
    });
    expect(second.statusCode).toBe(200);
    // Same run, and the port was NOT driven a second time.
    expect(second.json().migration.id).toBe(firstId);
    expect(port.calls.length).toBe(callsAfterFirst);
  });

  it("cross-tenant key replay → 409 conflict, no leak of tenant A's refs, no saga for B", async () => {
    const TENANT_B = "22222222-2222-2222-2222-222222222222";
    // One control-plane namespace shared across tenants (keys are global).
    const sagaStore = new MemorySagaStateStore();
    const port = fakePort();

    // Tenant A promotes successfully under the shared key.
    const storeA = new MemoryTenantStore();
    storeA.seed(poolTenant());
    const appA = buildApp({ config, store: storeA, siloPort: port, sagaStore });
    const first = await appA.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "shared-key" },
    });
    expect(first.statusCode).toBe(200);
    const callsAfterA = port.calls.length;

    // Tenant B replays the SAME key against its own path.
    const storeB = new MemoryTenantStore();
    storeB.seed(poolTenant({ id: TENANT_B, slug: "beta", name: "Beta Academy" }));
    const appB = buildApp({ config, store: storeB, siloPort: port, sagaStore });
    const res = await appB.inject({
      method: "POST",
      url: `/tenants/${TENANT_B}/promote-to-silo`,
      payload: { idempotencyKey: "shared-key" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("idempotency_key_conflict");
    // Must NOT echo tenant A's run / opaque refs.
    expect(res.json().migration).toBeUndefined();
    const serialized = JSON.stringify(res.json());
    expect(serialized).not.toContain(TENANT_ID);
    expect(serialized).not.toContain(`secret://${TENANT_ID}/dsn`);
    // No second saga ran for B: the port was not driven again, and B stayed pool.
    expect(port.calls.length).toBe(callsAfterA);
    const tenantB = await storeB.getTenant(TENANT_B);
    expect(tenantB?.tier).toBe("pool");
    expect(tenantB?.databaseRef).toBeNull();
  });

  it("already-silo tenant → 409 already_silo", async () => {
    const store = new MemoryTenantStore();
    store.seed(poolTenant({ tier: "silo", databaseRef: "secret://x/dsn" }));
    const { app } = build({ store });
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-already" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_silo");
  });

  it("400s a missing idempotencyKey", async () => {
    const { app } = build();
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a non-uuid tenant id", async () => {
    const { app } = build();
    const res = await app.inject({
      method: "POST",
      url: `/tenants/not-a-uuid/promote-to-silo`,
      payload: { idempotencyKey: "k" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s promotion for an unknown tenant", async () => {
    const { app } = build();
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${MISSING_ID}/promote-to-silo`,
      payload: { idempotencyKey: "k" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET silo-migration returns the run after a promotion", async () => {
    const { app } = build();
    await app.inject({
      method: "POST",
      url: `/tenants/${TENANT_ID}/promote-to-silo`,
      payload: { idempotencyKey: "key-get" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_ID}/silo-migration`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().migration.status).toBe("completed");
  });

  it("GET silo-migration 404s when no run exists", async () => {
    const { app } = build();
    const res = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_ID}/silo-migration`,
    });
    expect(res.statusCode).toBe(404);
  });
});
