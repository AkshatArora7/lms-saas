import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { DEMO_TENANT_ID, MemoryGroupStore } from "./groups.memory.js";
import { buildApp } from "./main.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};
const OTHER: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: config.DATABASE_URL,
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER.tenantId ? OTHER : TENANT;
}

const ASSIGN = "a5500000-0000-0000-0000-000000000001";

function build() {
  const groupStore = new MemoryGroupStore();
  groupStore.seedAssignment(DEMO_TENANT_ID, ASSIGN);
  return { app: buildApp({ config, groupStore, resolveTenant }), groupStore };
}

const H = { "x-tenant-id": DEMO_TENANT_ID };

async function makeGroup(app: ReturnType<typeof build>["app"], name: string) {
  return app.inject({
    method: "POST",
    url: `/assignments/${ASSIGN}/groups`,
    headers: H,
    payload: { name },
  });
}

describe("group assignments (#39)", () => {
  it("creates groups under an assignment; 404 for unknown assignment", async () => {
    const { app } = build();
    const g = await makeGroup(app, "Team Alpha");
    expect(g.statusCode).toBe(201);
    expect(g.json().group).toMatchObject({ name: "Team Alpha", assignmentId: ASSIGN });

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/assignments/99999999-9999-9999-9999-999999999999/groups`,
          headers: H,
          payload: { name: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect((await makeGroup(app, "")).statusCode).toBe(400);
  });

  it("manages membership and keeps a learner in one group per assignment", async () => {
    const { app } = build();
    const g1 = (await makeGroup(app, "Team A")).json().group.id;
    const g2 = (await makeGroup(app, "Team B")).json().group.id;

    const add = await app.inject({
      method: "POST",
      url: `/groups/${g1}/members`,
      headers: H,
      payload: { userId: "stu-1" },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().members).toEqual(["stu-1"]);

    // Same learner cannot join a sibling group for the same assignment.
    const dupe = await app.inject({
      method: "POST",
      url: `/groups/${g2}/members`,
      headers: H,
      payload: { userId: "stu-1" },
    });
    expect(dupe.statusCode).toBe(409);

    // group-for-user resolves the membership (for group submission).
    const forUser = await app.inject({
      method: "GET",
      url: `/assignments/${ASSIGN}/groups/for-user/stu-1`,
      headers: H,
    });
    expect(forUser.json().group.id).toBe(g1);

    // Remove, then they may join the other group.
    expect(
      (await app.inject({ method: "DELETE", url: `/groups/${g1}/members/stu-1`, headers: H }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/groups/${g2}/members`,
          headers: H,
          payload: { userId: "stu-1" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("lists groups with members, gets one, deletes; 404s for missing", async () => {
    const { app } = build();
    const id = (await makeGroup(app, "Solo")).json().group.id;
    await app.inject({
      method: "POST",
      url: `/groups/${id}/members`,
      headers: H,
      payload: { userId: "u9" },
    });
    const list = await app.inject({
      method: "GET",
      url: `/assignments/${ASSIGN}/groups`,
      headers: H,
    });
    expect(list.json().groups[0].members).toEqual(["u9"]);
    expect((await app.inject({ method: "GET", url: `/groups/${id}`, headers: H })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/groups/${id}`, headers: H })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/groups/${id}`, headers: H })).statusCode).toBe(404);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/groups/99999999-9999-9999-9999-999999999999/members`,
          headers: H,
          payload: { userId: "x" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("isolates groups per tenant", async () => {
    const { app } = build();
    await makeGroup(app, "Private");
    const other = await app.inject({
      method: "GET",
      url: `/assignments/${ASSIGN}/groups`,
      headers: { "x-tenant-id": OTHER.tenantId },
    });
    expect(other.json().groups).toHaveLength(0);
  });
});
