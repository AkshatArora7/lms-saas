import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import {
  isDescendantOf,
  tenantAccessDecision,
  type TenantNode,
} from "./delegation.js";
import { MemoryDelegationStore } from "./delegation.memory.js";
import { buildApp } from "./main.js";
import { createSeededMemoryStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

// District -> School A, School B (siblings).
const DISTRICT = "11111111-1111-1111-1111-111111111111";
const SCHOOL_A = "22222222-2222-2222-2222-222222222222";
const SCHOOL_B = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";

function build() {
  const delegationStore = new MemoryDelegationStore();
  delegationStore.seedTenant(DISTRICT, null);
  delegationStore.seedTenant(SCHOOL_A, DISTRICT);
  delegationStore.seedTenant(SCHOOL_B, DISTRICT);
  return buildApp({
    config,
    store: createSeededMemoryStore(),
    delegationStore,
  });
}

const NODES: TenantNode[] = [
  { id: DISTRICT, parentId: null },
  { id: SCHOOL_A, parentId: DISTRICT },
  { id: SCHOOL_B, parentId: DISTRICT },
];

describe("hierarchy + access policy (pure)", () => {
  it("resolves descendants", () => {
    expect(isDescendantOf(SCHOOL_A, DISTRICT, NODES)).toBe(true);
    expect(isDescendantOf(DISTRICT, SCHOOL_A, NODES)).toBe(false);
    expect(isDescendantOf(SCHOOL_A, SCHOOL_B, NODES)).toBe(false); // siblings
  });

  it("allows own tenant, ancestor override, and delegated; denies siblings", () => {
    const actor = { tenantId: SCHOOL_A, userId: USER };
    expect(
      tenantAccessDecision({ actor, targetTenantId: SCHOOL_A, targetIsDescendant: false, hasDelegation: false }).reason,
    ).toBe("own_tenant");
    expect(
      tenantAccessDecision({ actor: { tenantId: DISTRICT, userId: USER }, targetTenantId: SCHOOL_A, targetIsDescendant: true, hasDelegation: false }).reason,
    ).toBe("ancestor_override");
    expect(
      tenantAccessDecision({ actor, targetTenantId: SCHOOL_B, targetIsDescendant: false, hasDelegation: true }).reason,
    ).toBe("delegated");
    const denied = tenantAccessDecision({ actor, targetTenantId: SCHOOL_B, targetIsDescendant: false, hasDelegation: false });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("denied_cross_tenant");
  });
});

describe("sub-tenant admin delegation (#5)", () => {
  it("delegates admin of a sub-tenant and lists it", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${SCHOOL_A}/delegations`,
      payload: { delegatorTenantId: DISTRICT, delegateUserId: USER },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().delegation).toMatchObject({
      scopeTenantId: SCHOOL_A,
      delegateUserId: USER,
      role: "school_admin",
    });

    const list = await app.inject({ method: "GET", url: `/tenants/${SCHOOL_A}/delegations` });
    expect(list.json().delegations).toHaveLength(1);
  });

  it("rejects delegating a tenant that is not a descendant of the delegator", async () => {
    const app = build();
    // SCHOOL_B is not a descendant of SCHOOL_A.
    const res = await app.inject({
      method: "POST",
      url: `/tenants/${SCHOOL_B}/delegations`,
      payload: { delegatorTenantId: SCHOOL_A, delegateUserId: USER },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces access: district override yes, sibling no, delegated yes", async () => {
    const app = build();

    // District admin can administer School A (override visibility).
    const districtToA = await app.inject({
      method: "GET",
      url: `/tenants/${SCHOOL_A}/access-check?actorTenantId=${DISTRICT}&actorUserId=${USER}`,
    });
    expect(districtToA.json().decision.allowed).toBe(true);

    // School A admin CANNOT administer sibling School B.
    const aToB = await app.inject({
      method: "GET",
      url: `/tenants/${SCHOOL_B}/access-check?actorTenantId=${SCHOOL_A}&actorUserId=${USER}`,
    });
    expect(aToB.json().decision.allowed).toBe(false);
    expect(aToB.json().decision.reason).toBe("denied_cross_tenant");

    // After delegating School B to the user, they may administer it (only it).
    await app.inject({
      method: "POST",
      url: `/tenants/${SCHOOL_B}/delegations`,
      payload: { delegatorTenantId: DISTRICT, delegateUserId: USER },
    });
    const delegated = await app.inject({
      method: "GET",
      url: `/tenants/${SCHOOL_B}/access-check?actorTenantId=${SCHOOL_A}&actorUserId=${USER}`,
    });
    expect(delegated.json().decision.allowed).toBe(true);
    expect(delegated.json().decision.reason).toBe("delegated");
  });

  it("revokes a delegation and re-denies access", async () => {
    const app = build();
    const created = await app.inject({
      method: "POST",
      url: `/tenants/${SCHOOL_B}/delegations`,
      payload: { delegatorTenantId: DISTRICT, delegateUserId: USER },
    });
    const did = created.json().delegation.id;

    const revoke = await app.inject({
      method: "POST",
      url: `/tenants/${SCHOOL_B}/delegations/${did}/revoke`,
    });
    expect(revoke.statusCode).toBe(200);

    const afterRevoke = await app.inject({
      method: "GET",
      url: `/tenants/${SCHOOL_B}/access-check?actorTenantId=${SCHOOL_A}&actorUserId=${USER}`,
    });
    expect(afterRevoke.json().decision.allowed).toBe(false);
  });

  it("validates uuids", async () => {
    const app = build();
    expect(
      (await app.inject({ method: "POST", url: `/tenants/not-a-uuid/delegations`, payload: {} })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: `/tenants/${SCHOOL_A}/access-check?actorTenantId=x&actorUserId=${USER}` })).statusCode,
    ).toBe(400);
  });
});
