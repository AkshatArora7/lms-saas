import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { MemoryTenantStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

function build() {
  // Plan codes the memory store knows (mirrors seeded `plan` rows).
  const store = new MemoryTenantStore(undefined, undefined, ["core", "pro"]);
  return buildApp({ config, store });
}

async function provision(
  app: ReturnType<typeof build>,
  payload: Record<string, unknown>,
) {
  return app.inject({ method: "POST", url: "/tenants", payload });
}

async function district(app: ReturnType<typeof build>, plan?: string) {
  const res = await provision(app, {
    slug: "metro-district",
    name: "Metro District",
    ...(plan ? { plan } : {}),
  });
  return res.json().tenant;
}

describe("district with school sub-tenants (#4)", () => {
  it("registers a school as a sub-tenant under a district and promotes the parent", async () => {
    const app = build();
    const d = await district(app, "pro");
    expect(d.kind).toBe("standalone");

    const school = await provision(app, {
      slug: "north-high",
      name: "North High",
      parentTenantId: d.id,
    });
    expect(school.statusCode).toBe(201);
    expect(school.json().tenant).toMatchObject({
      kind: "sub",
      parentId: d.id,
    });

    // The district was promoted from standalone -> parent on its first child.
    const reread = await app.inject({ method: "GET", url: `/tenants/${d.id}` });
    expect(reread.json().tenant.kind).toBe("parent");
  });

  it("inherits the parent's plan unless overridden", async () => {
    const app = build();
    const d = await district(app, "pro");

    const inherited = await provision(app, {
      slug: "inherit-school",
      name: "Inherit School",
      parentTenantId: d.id,
    });
    expect(inherited.json().tenant.planId).toBe(d.planId);
    expect(inherited.json().tenant.planId).toBe("pro");

    const overridden = await provision(app, {
      slug: "override-school",
      name: "Override School",
      parentTenantId: d.id,
      plan: "core",
    });
    expect(overridden.json().tenant.planId).toBe("core");
  });

  it("404s a sub-tenant under an unknown parent", async () => {
    const app = build();
    const res = await provision(app, {
      slug: "orphan",
      name: "Orphan",
      parentTenantId: "99999999-9999-9999-9999-999999999999",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("unknown_parent");
  });

  it("lists and searches a district's child sub-tenants", async () => {
    const app = build();
    const d = await district(app);
    await provision(app, { slug: "north-high", name: "North High", parentTenantId: d.id });
    await provision(app, { slug: "south-high", name: "South High", parentTenantId: d.id });
    // A second, unrelated district + school must not appear.
    const other = (await provision(app, { slug: "other-district", name: "Other" })).json().tenant;
    await provision(app, { slug: "other-school", name: "Other School", parentTenantId: other.id });

    const all = await app.inject({ method: "GET", url: `/tenants/${d.id}/children` });
    expect(all.json().children).toHaveLength(2);

    const search = await app.inject({ method: "GET", url: `/tenants/${d.id}/children?q=north` });
    expect(search.json().children).toHaveLength(1);
    expect(search.json().children[0].slug).toBe("north-high");
  });

  it("scopes the subtree (aggregate reporting) to the district only", async () => {
    const app = build();
    const d = await district(app);
    await provision(app, { slug: "a-school", name: "A School", parentTenantId: d.id });
    await provision(app, { slug: "b-school", name: "B School", parentTenantId: d.id });
    const other = (await provision(app, { slug: "rival-district", name: "Rival" })).json().tenant;
    await provision(app, { slug: "rival-school", name: "Rival School", parentTenantId: other.id });

    const subtree = await app.inject({ method: "GET", url: `/tenants/${d.id}/subtree` });
    const ids = subtree.json().tenants.map((t: { id: string }) => t.id);
    expect(subtree.json().tenants).toHaveLength(3); // district + 2 schools
    expect(ids).toContain(d.id);
    expect(ids).not.toContain(other.id);
  });

  it("404s children/subtree for an unknown tenant and validates the id", async () => {
    const app = build();
    expect(
      (await app.inject({ method: "GET", url: `/tenants/99999999-9999-9999-9999-999999999999/children` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `/tenants/not-a-uuid/subtree` })).statusCode,
    ).toBe(400);
  });
});
