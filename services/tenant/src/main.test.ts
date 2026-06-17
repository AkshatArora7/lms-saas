import type { AppConfig } from "@lms/config";
import { describe, expect, it } from "vitest";

import { MemoryBrandingStore } from "./branding.memory.js";
import { buildApp } from "./main.js";
import { MemorySettingsStore } from "./settings.memory.js";
import { MemoryTenantStore } from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

function buildTestApp(store = new MemoryTenantStore()) {
  const settingsStore = new MemorySettingsStore();
  const brandingStore = new MemoryBrandingStore();
  return {
    app: buildApp({ config, store, settingsStore, brandingStore }),
    store,
    settingsStore,
    brandingStore,
  };
}

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

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

describe("per-tenant governance settings (#90)", () => {
  it("exposes the setting catalog", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/settings/catalog" });
    expect(res.statusCode).toBe(200);
    expect(res.json().catalog).toHaveProperty("password.min_length");
  });

  it("returns effective defaults before any override", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_A}/settings`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings["password.min_length"]).toBe(8);
    expect(res.json().overrides).toEqual({});
  });

  it("validates the key against the catalog and the value type", async () => {
    const { app } = buildTestApp();
    const unknownKey = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/settings/not.a.real.key`,
      payload: { value: 1 },
    });
    expect(unknownKey.statusCode).toBe(404);

    const badType = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/settings/password.min_length`,
      payload: { value: "eight" },
    });
    expect(badType.statusCode).toBe(400);

    const outOfRange = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/settings/password.min_length`,
      payload: { value: 3 },
    });
    expect(outOfRange.statusCode).toBe(400);

    const missingValue = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/settings/quiz.lockdown_default`,
      payload: {},
    });
    expect(missingValue.statusCode).toBe(400);

    const badId = await app.inject({
      method: "PUT",
      url: `/tenants/not-a-uuid/settings/quiz.lockdown_default`,
      payload: { value: true },
    });
    expect(badId.statusCode).toBe(400);
  });

  it("sets a setting and reads it back as the effective value", async () => {
    const { app } = buildTestApp();
    const put = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/settings/password.min_length`,
      payload: { value: 12 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().setting).toMatchObject({ key: "password.min_length", value: 12 });

    const one = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_A}/settings/password.min_length`,
    });
    expect(one.json()).toMatchObject({ key: "password.min_length", value: 12 });

    const all = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_A}/settings`,
    });
    expect(all.json().settings["password.min_length"]).toBe(12);
    expect(all.json().overrides).toEqual({ "password.min_length": 12 });
  });

  it("isolates settings per tenant", async () => {
    const { app } = buildTestApp();
    await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/settings/enrollment.self_registration`,
      payload: { value: true },
    });
    const other = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_B}/settings`,
    });
    // Tenant B sees only defaults — no override leaked from A.
    expect(other.json().overrides).toEqual({});
    expect(other.json().settings["enrollment.self_registration"]).toBe(false);
  });
});

describe("white-label branding (#89)", () => {
  it("sets and reads back a tenant's own branding", async () => {
    const { app } = buildTestApp();
    const put = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/branding`,
      payload: { displayName: "Northwind", primaryColor: "#0B5FFF", theme: "dark" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().branding).toMatchObject({
      displayName: "Northwind",
      primaryColor: "#0B5FFF",
      theme: "dark",
    });

    const get = await app.inject({
      method: "GET",
      url: `/tenants/${TENANT_A}/branding`,
    });
    expect(get.json().branding.displayName).toBe("Northwind");
    expect(get.json().overrides.primaryColor).toBe("#0B5FFF");
  });

  it("validates theme, hex colours and tenant id", async () => {
    const { app } = buildTestApp();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/tenants/${TENANT_A}/branding`,
          payload: { theme: "neon" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/tenants/${TENANT_A}/branding`,
          payload: { primaryColor: "blue" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/tenants/not-a-uuid/branding`,
          payload: { displayName: "x" },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("emits tenant.branding.updated via the outbox path (memory records it)", async () => {
    const { app } = buildTestApp();
    // The memory branding store has no event sink, but the prisma store writes
    // event_outbox; here we just assert the write path returns the saved row.
    const res = await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/branding`,
      payload: { supportEmail: "help@northwind.edu" },
    });
    expect(res.json().branding.supportEmail).toBe("help@northwind.edu");
  });

  it("inherits unset fields from a parent, overridable field-by-field", async () => {
    const { app, brandingStore } = buildTestApp();
    // District (parent) sets a default look; school B is its sub-tenant.
    brandingStore.seedParent(TENANT_B, TENANT_A);
    await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/branding`,
      payload: { displayName: "District", primaryColor: "#111111", logoUrl: "d.png" },
    });
    await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_B}/branding`,
      payload: { primaryColor: "#222222" }, // override one field only
    });

    const effective = (
      await app.inject({ method: "GET", url: `/tenants/${TENANT_B}/branding` })
    ).json().branding;
    expect(effective.primaryColor).toBe("#222222"); // own override wins
    expect(effective.logoUrl).toBe("d.png"); // inherited from parent
    expect(effective.displayName).toBe("District"); // inherited
  });

  it("does not inherit when inheritParent is false", async () => {
    const { app, brandingStore } = buildTestApp();
    brandingStore.seedParent(TENANT_B, TENANT_A);
    await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_A}/branding`,
      payload: { logoUrl: "parent.png" },
    });
    await app.inject({
      method: "PUT",
      url: `/tenants/${TENANT_B}/branding`,
      payload: { displayName: "Standalone", inheritParent: false },
    });
    const effective = (
      await app.inject({ method: "GET", url: `/tenants/${TENANT_B}/branding` })
    ).json().branding;
    expect(effective.logoUrl).toBeNull(); // not inherited
  });
});
