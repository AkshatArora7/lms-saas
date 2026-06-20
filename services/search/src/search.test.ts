import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemorySearchStore } from "./store.memory.js";
import { rankResults, trigramSimilarity, type RankableRow } from "./store.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT = DEMO_TENANT_ID;
const OTHER = "22222222-2222-2222-2222-222222222222";
const OU_X = "33333333-3333-3333-3333-333333333333";
const OU_Y = "44444444-4444-4444-4444-444444444444";

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

function build(store = new MemorySearchStore()) {
  return { app: buildApp({ config, store, resolveTenant }), store };
}

const H = { "x-tenant-id": TENANT };
const OTHER_H = { "x-tenant-id": OTHER };

function doc(extra: Record<string, unknown> = {}) {
  return {
    entityType: "course",
    entityId: "00000000-0000-0000-0000-000000000001",
    title: "Introduction to Algebra",
    ...extra,
  };
}

async function put(
  app: ReturnType<typeof build>["app"],
  payload: unknown,
  headers = H,
) {
  return app.inject({ method: "PUT", url: "/search/documents", headers, payload });
}

describe("ranking (pure)", () => {
  it("trigramSimilarity is symmetric-ish and bounded in [0,1]", () => {
    const exact = trigramSimilarity("algebra", "algebra");
    const partial = trigramSimilarity("algebra basics", "algebra");
    const none = trigramSimilarity("calculus", "zzzzzz");
    expect(exact).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(none);
    expect(exact).toBeLessThanOrEqual(1);
    expect(none).toBeGreaterThanOrEqual(0);
  });

  it("rankResults orders closer matches first and applies limit", () => {
    const rows: RankableRow[] = [
      {
        entityType: "course",
        entityId: "a",
        title: "Linear Algebra",
        orgUnitId: null,
        searchText: "Linear Algebra",
        embedding: null,
      },
      {
        entityType: "course",
        entityId: "b",
        title: "Algebra",
        orgUnitId: null,
        searchText: "Algebra",
        embedding: null,
      },
      {
        entityType: "course",
        entityId: "c",
        title: "Geometry",
        orgUnitId: null,
        searchText: "Geometry",
        embedding: null,
      },
    ];
    const hits = rankResults(rows, "Algebra", { limit: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.entityId).toBe("b");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("rankResults blends semantic when embeddings present", () => {
    const rows: RankableRow[] = [
      {
        entityType: "course",
        entityId: "a",
        title: "Cooking",
        orgUnitId: null,
        searchText: "Cooking",
        embedding: [1, 0, 0],
      },
      {
        entityType: "course",
        entityId: "b",
        title: "Baking",
        orgUnitId: null,
        searchText: "Baking",
        embedding: [0, 1, 0],
      },
    ];
    // Query embedding aligns with "a"; keyword scores are both ~0 for "xyz".
    const hits = rankResults(rows, "xyz", { queryEmbedding: [1, 0, 0] });
    expect(hits[0]!.entityId).toBe("a");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });
});

describe("search service (#69)", () => {
  it("health reports ok", async () => {
    const res = await build().app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("search");
  });

  it("indexes a document then returns it as a search hit", async () => {
    const { app } = build();
    const idx = await put(app, doc({ body: "Linear equations and polynomials." }));
    expect(idx.statusCode).toBe(200);
    expect(idx.json().document).toMatchObject({
      entityType: "course",
      title: "Introduction to Algebra",
    });

    const res = await app.inject({
      method: "GET",
      url: "/search?q=algebra",
      headers: H,
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ entityType: "course", title: "Introduction to Algebra" });
  });

  it("ranks the closer match first", async () => {
    const { app } = build();
    await put(app, { entityType: "course", entityId: "c1", title: "Algebra" });
    await put(app, { entityType: "course", entityId: "c2", title: "Advanced Linear Algebra Concepts" });
    const res = await app.inject({ method: "GET", url: "/search?q=Algebra", headers: H });
    const results = res.json().results;
    expect(results[0].entityId).toBe("c1");
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it("validates index input and a blank query", async () => {
    const { app } = build();
    expect((await put(app, { entityId: "x", title: "t" })).statusCode).toBe(400);
    expect((await put(app, { entityType: "course", title: "t" })).statusCode).toBe(400);
    expect((await put(app, { entityType: "course", entityId: "x" })).statusCode).toBe(400);
    expect((await put(app, doc({ embedding: "nope" }))).statusCode).toBe(400);
    const blank = await app.inject({ method: "GET", url: "/search?q=", headers: H });
    expect(blank.statusCode).toBe(400);
    const missing = await app.inject({ method: "GET", url: "/search", headers: H });
    expect(missing.statusCode).toBe(400);
  });

  it("requires a tenant", async () => {
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/search?q=algebra" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });

  it("typeahead is title-only and respects limit", async () => {
    const { app } = build();
    // Body mentions "physics" but title does not — title-only must not match.
    await put(app, { entityType: "course", entityId: "p1", title: "Chemistry", body: "physics adjacent" });
    await put(app, { entityType: "course", entityId: "ph1", title: "Physics 101" });
    await put(app, { entityType: "course", entityId: "ph2", title: "Physics 201" });

    const res = await app.inject({
      method: "GET",
      url: "/search/typeahead?q=Physics&limit=1",
      headers: H,
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results;
    expect(results).toHaveLength(1);
    expect(results[0].title).toMatch(/Physics/);
  });

  it("permission filter hides org-scoped docs but always shows tenant-global ones", async () => {
    const { app } = build();
    await put(app, { entityType: "course", entityId: "g", title: "Global Algebra", orgUnitId: null });
    await put(app, { entityType: "course", entityId: "x", title: "Dept X Algebra", orgUnitId: OU_X });
    await put(app, { entityType: "course", entityId: "y", title: "Dept Y Algebra", orgUnitId: OU_Y });

    // Caller is allowed only OU_Y: sees the global doc and the OU_Y doc, not OU_X.
    const res = await app.inject({
      method: "GET",
      url: `/search?q=Algebra&orgUnit=${OU_Y}`,
      headers: H,
    });
    const ids = (res.json().results as { entityId: string }[]).map((r) => r.entityId).sort();
    expect(ids).toEqual(["g", "y"]);
  });

  it("isolates tenants — another tenant never sees the doc", async () => {
    const { app } = build();
    await put(app, doc());
    const mine = await app.inject({ method: "GET", url: "/search?q=algebra", headers: H });
    expect(mine.json().results).toHaveLength(1);
    const other = await app.inject({ method: "GET", url: "/search?q=algebra", headers: OTHER_H });
    expect(other.json().results).toHaveLength(0);
  });

  it("upsert is idempotent — re-indexing the same entity updates, no dup", async () => {
    const { app } = build();
    await put(app, doc({ title: "Old Title" }));
    await put(app, doc({ title: "New Title" }));
    const res = await app.inject({ method: "GET", url: "/search?q=Title", headers: H });
    const results = res.json().results;
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("New Title");
  });

  it("delete returns 204 then the doc is gone", async () => {
    const { app } = build();
    await put(app, doc());
    const del = await app.inject({
      method: "DELETE",
      url: "/search/documents/course/00000000-0000-0000-0000-000000000001",
      headers: H,
    });
    expect(del.statusCode).toBe(204);
    const res = await app.inject({ method: "GET", url: "/search?q=algebra", headers: H });
    expect(res.json().results).toHaveLength(0);
  });
});
