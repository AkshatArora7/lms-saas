import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { validateUpload, blobKey } from "./blob.js";
import { buildApp } from "./main.js";
import { DEMO_TENANT_ID, MemoryContentStore } from "./store.memory.js";

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

function build(store = new MemoryContentStore()) {
  return buildApp({ config, store, resolveTenant });
}

const H = { "x-tenant-id": DEMO_TENANT_ID };
const OTHER_H = { "x-tenant-id": OTHER.tenantId };
const COURSE = "c0000000-0000-0000-0000-000000000001";

async function createModule(app: ReturnType<typeof build>, title = "Week 1") {
  return app.inject({
    method: "POST",
    url: `/courses/${COURSE}/modules`,
    headers: H,
    payload: { title },
  });
}

describe("content: blob upload helpers (pure)", () => {
  it("validates content type and size", () => {
    expect(validateUpload("application/pdf", 1024).ok).toBe(true);
    expect(validateUpload("application/x-evil", 1024).ok).toBe(false);
    expect(validateUpload("application/pdf", 0).ok).toBe(false);
    expect(validateUpload("application/pdf", 10, 5).ok).toBe(false);
  });

  it("namespaces the blob key by tenant", () => {
    const key = blobKey(DEMO_TENANT_ID, "abc", "My File!.pdf");
    expect(key.startsWith(`t/${DEMO_TENANT_ID}/content/abc/`)).toBe(true);
    expect(key.endsWith("My_File_.pdf")).toBe(true);
  });
});

describe("content: uploads (#30)", () => {
  it("returns a tenant-namespaced signed upload URL", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: H,
      payload: { filename: "slides.pdf", contentType: "application/pdf", sizeBytes: 2048 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().upload.key).toContain(`t/${DEMO_TENANT_ID}/content/`);
    expect(res.json().upload.uploadUrl).toContain("upload=1");
  });

  it("rejects unsupported types (415) and oversized files (413)", async () => {
    const app = buildApp({ config, resolveTenant, maxUploadBytes: 100 });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/uploads",
          headers: H,
          payload: { filename: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10 },
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/uploads",
          headers: H,
          payload: { filename: "x.pdf", contentType: "application/pdf", sizeBytes: 9999 },
        })
      ).statusCode,
    ).toBe(413);
  });
});

describe("content: modules & topics (#27)", () => {
  it("creates ordered modules and nested topics", async () => {
    const app = build();
    const m = await createModule(app, "Unit 1");
    expect(m.statusCode).toBe(201);
    const moduleId = m.json().module.id;

    const t = await app.inject({
      method: "POST",
      url: `/modules/${moduleId}/topics`,
      headers: H,
      payload: { title: "Lesson 1", kind: "file", blobUrl: "https://blob.local/x", isRequired: true },
    });
    expect(t.statusCode).toBe(201);
    expect(t.json().topic).toMatchObject({ kind: "file", isRequired: true });

    const detail = await app.inject({ method: "GET", url: `/modules/${moduleId}`, headers: H });
    expect(detail.json().module.topics).toHaveLength(1);

    const list = await app.inject({
      method: "GET",
      url: `/courses/${COURSE}/modules`,
      headers: H,
    });
    expect(list.json().modules).toHaveLength(1);
  });

  it("validates titles and topic kinds; 404s for missing module/topic", async () => {
    const app = build();
    expect((await createModule(app, "")).statusCode).toBe(400);
    const moduleId = (await createModule(app)).json().module.id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/modules/${moduleId}/topics`,
          headers: H,
          payload: { title: "x", kind: "hologram" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/modules/99999999-9999-9999-9999-999999999999/topics`,
          headers: H,
          payload: { title: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/modules/99999999-9999-9999-9999-999999999999", headers: H }))
        .statusCode,
    ).toBe(404);
  });

  it("updates and deletes modules/topics", async () => {
    const app = build();
    const moduleId = (await createModule(app)).json().module.id;
    const topicId = (
      await app.inject({
        method: "POST",
        url: `/modules/${moduleId}/topics`,
        headers: H,
        payload: { title: "T" },
      })
    ).json().topic.id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/topics/${topicId}`,
      headers: H,
      payload: { title: "T2", position: 3 },
    });
    expect(patched.json().topic).toMatchObject({ title: "T2", position: 3 });

    expect(
      (await app.inject({ method: "DELETE", url: `/topics/${topicId}`, headers: H }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "DELETE", url: `/modules/${moduleId}`, headers: H }))
        .statusCode,
    ).toBe(204);
  });
});

describe("content: release conditions (#27)", () => {
  it("creates and lists release conditions; validates the expression", async () => {
    const app = build();
    const ok = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/release-conditions`,
      headers: H,
      payload: {
        targetType: "content_topic",
        targetId: "a0000000-0000-0000-0000-000000000001",
        expression: { all: [{ availableFrom: "2026-02-01" }] },
      },
    });
    expect(ok.statusCode).toBe(201);

    const bad = await app.inject({
      method: "POST",
      url: `/courses/${COURSE}/release-conditions`,
      headers: H,
      payload: { targetType: "content_topic", targetId: "x", expression: "nope" },
    });
    expect(bad.statusCode).toBe(400);

    const list = await app.inject({
      method: "GET",
      url: `/courses/${COURSE}/release-conditions`,
      headers: H,
    });
    expect(list.json().conditions).toHaveLength(1);
  });
});

describe("content: tenant isolation", () => {
  it("never returns another tenant's modules", async () => {
    const app = build();
    await createModule(app);
    const other = await app.inject({
      method: "GET",
      url: `/courses/${COURSE}/modules`,
      headers: OTHER_H,
    });
    expect(other.json().modules).toHaveLength(0);
  });
});
