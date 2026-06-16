import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import { MemoryTenantStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

function buildTestApp(store = new MemoryTenantStore()) {
  return { app: buildApp({ config, store }), store };
}

async function provision(
  app: ReturnType<typeof buildApp>,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/tenants",
    payload: { slug: "acme", name: "Acme University", ...overrides },
  });
}

describe("tenant service health", () => {
  it("reports ok", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "tenant", status: "ok" });
  });
});

describe("tenant provisioning", () => {
  it("provisions a pool tenant (201) that is active with a subdomain", async () => {
    const { app } = buildTestApp();
    const res = await provision(app);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      tenant: {
        slug: "acme",
        name: "Acme University",
        tier: "pool",
        kind: "standalone",
        status: "active",
        region: "us-east",
        subdomain: "acme.lms.app",
      },
    });
  });

  it("rejects a duplicate slug (409), case-insensitively", async () => {
    const { app } = buildTestApp();
    const first = await provision(app, { slug: "Acme" });
    expect(first.statusCode).toBe(201);

    const dup = await provision(app, { slug: "acme" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "slug_taken" });
  });

  it("requires a slug (400)", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { name: "No Slug" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires a name (400)", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { slug: "noname" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid slug (400)", async () => {
    const { app } = buildTestApp();
    const res = await provision(app, { slug: "bad slug!" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("rejects an unknown plan (400)", async () => {
    const { app } = buildTestApp();
    const res = await provision(app, { plan: "does_not_exist" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "unknown_plan" });
  });

  it("emits exactly one tenant.provisioned outbox event with the slug", async () => {
    const { app, store } = buildTestApp();
    const res = await provision(app, { slug: "eventco" });
    expect(res.statusCode).toBe(201);

    const events = store.emittedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tenant.provisioned",
      payload: { slug: "eventco" },
    });
    const { tenant } = res.json() as { tenant: { id: string } };
    expect(events[0]!.tenantId).toBe(tenant.id);
  });

  it("reads a provisioned tenant by id (200) and 404s for a missing id", async () => {
    const { app } = buildTestApp();
    const created = await provision(app);
    const { tenant } = created.json() as { tenant: { id: string } };

    const found = await app.inject({
      method: "GET",
      url: `/tenants/${tenant.id}`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ tenant: { slug: "acme" } });

    const missing = await app.inject({
      method: "GET",
      url: "/tenants/00000000-0000-0000-0000-000000000000",
    });
    expect(missing.statusCode).toBe(404);
  });

  it("lists provisioned tenants", async () => {
    const { app } = buildTestApp();
    await provision(app, { slug: "one", name: "One" });
    await provision(app, { slug: "two", name: "Two" });
    const res = await app.inject({ method: "GET", url: "/tenants" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { tenants: unknown[] }).tenants).toHaveLength(2);
  });
});
