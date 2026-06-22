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

async function createPage(
  app: ReturnType<typeof build>,
  payload: { title?: string; slug?: string; body?: string } = {},
  headers = H,
) {
  return app.inject({
    method: "POST",
    url: `/courses/${COURSE}/pages`,
    headers,
    payload: { title: "My Page", ...payload },
  });
}

describe("content: rich pages (#32)", () => {
  it("creates a page with version #1 and a derived slug", async () => {
    const app = build();
    const res = await createPage(app, { title: "Welcome, Students!", body: "<p>Hi</p>" });
    expect(res.statusCode).toBe(201);
    expect(res.json().page).toMatchObject({
      title: "Welcome, Students!",
      slug: "welcome-students",
      status: "draft",
      publishedVersionId: null,
    });

    const pageId = res.json().page.id;
    const versions = await app.inject({
      method: "GET",
      url: `/pages/${pageId}/versions`,
      headers: H,
    });
    expect(versions.json().versions).toHaveLength(1);
    expect(versions.json().versions[0]).toMatchObject({
      versionNumber: 1,
      state: "draft",
      body: "<p>Hi</p>",
    });
  });

  it("honours an explicit slug (slugified) and empty default body", async () => {
    const app = build();
    const res = await createPage(app, { slug: "Custom Slug" });
    expect(res.json().page.slug).toBe("custom-slug");
    const pageId = res.json().page.id;
    const detail = await app.inject({ method: "GET", url: `/pages/${pageId}`, headers: H });
    expect(detail.json().page.currentVersion.body).toBe("");
  });

  it("lists pages for the course", async () => {
    const app = build();
    await createPage(app, { title: "Page A" });
    await createPage(app, { title: "Page B" });
    const list = await app.inject({
      method: "GET",
      url: `/courses/${COURSE}/pages`,
      headers: H,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().pages).toHaveLength(2);
  });

  it("getPage resolves current version to the latest draft", async () => {
    const app = build();
    const pageId = (await createPage(app, { body: "<p>v1</p>" })).json().page.id;
    await app.inject({
      method: "PATCH",
      url: `/pages/${pageId}`,
      headers: H,
      payload: { body: "<p>v2</p>" },
    });
    const detail = await app.inject({ method: "GET", url: `/pages/${pageId}`, headers: H });
    expect(detail.json().page.currentVersion).toMatchObject({
      versionNumber: 2,
      body: "<p>v2</p>",
      state: "draft",
    });
  });

  it("patch with body inserts a NEW draft version and never mutates prior", async () => {
    const app = build();
    const pageId = (await createPage(app, { body: "<p>v1</p>" })).json().page.id;
    const v1Id = (await app.inject({ method: "GET", url: `/pages/${pageId}/versions`, headers: H }))
      .json()
      .versions[0].id;

    await app.inject({
      method: "PATCH",
      url: `/pages/${pageId}`,
      headers: H,
      payload: { title: "Renamed", body: "<p>v2</p>" },
    });

    const versions = (await app.inject({ method: "GET", url: `/pages/${pageId}/versions`, headers: H })).json().versions;
    expect(versions).toHaveLength(2);
    // newest-first
    expect(versions[0]).toMatchObject({ versionNumber: 2, body: "<p>v2</p>" });
    // prior version untouched
    const v1 = await app.inject({
      method: "GET",
      url: `/pages/${pageId}/versions/${v1Id}`,
      headers: H,
    });
    expect(v1.json().version).toMatchObject({ versionNumber: 1, body: "<p>v1</p>" });

    // page row reflects the title update
    const detail = await app.inject({ method: "GET", url: `/pages/${pageId}`, headers: H });
    expect(detail.json().page.title).toBe("Renamed");
  });

  it("patch with no body does not add a version", async () => {
    const app = build();
    const pageId = (await createPage(app, { body: "<p>v1</p>" })).json().page.id;
    await app.inject({
      method: "PATCH",
      url: `/pages/${pageId}`,
      headers: H,
      payload: { title: "Just a title" },
    });
    const versions = (await app.inject({ method: "GET", url: `/pages/${pageId}/versions`, headers: H })).json().versions;
    expect(versions).toHaveLength(1);
  });

  it("publish promotes the latest draft (status + published_version_id)", async () => {
    const app = build();
    const pageId = (await createPage(app, { body: "<p>v1</p>" })).json().page.id;
    const draftId = (await app.inject({ method: "GET", url: `/pages/${pageId}/versions`, headers: H }))
      .json()
      .versions[0].id;

    const pub = await app.inject({
      method: "POST",
      url: `/pages/${pageId}/publish`,
      headers: H,
      payload: {},
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().page).toMatchObject({
      status: "published",
      publishedVersionId: draftId,
    });

    // After publish (no remaining draft), current version is the published one.
    const detail = await app.inject({ method: "GET", url: `/pages/${pageId}`, headers: H });
    expect(detail.json().page.currentVersion).toMatchObject({
      id: draftId,
      state: "published",
    });
  });

  it("publish accepts an explicit versionId", async () => {
    const app = build();
    const pageId = (await createPage(app, { body: "<p>v1</p>" })).json().page.id;
    const v1Id = (await app.inject({ method: "GET", url: `/pages/${pageId}/versions`, headers: H }))
      .json()
      .versions[0].id;
    // add a newer draft
    await app.inject({ method: "PATCH", url: `/pages/${pageId}`, headers: H, payload: { body: "<p>v2</p>" } });

    const pub = await app.inject({
      method: "POST",
      url: `/pages/${pageId}/publish`,
      headers: H,
      payload: { versionId: v1Id },
    });
    expect(pub.json().page.publishedVersionId).toBe(v1Id);
  });

  it("returns full body for a specific version", async () => {
    const app = build();
    const pageId = (await createPage(app, { body: "<p>hello</p>" })).json().page.id;
    const vId = (await app.inject({ method: "GET", url: `/pages/${pageId}/versions`, headers: H }))
      .json()
      .versions[0].id;
    const v = await app.inject({ method: "GET", url: `/pages/${pageId}/versions/${vId}`, headers: H });
    expect(v.statusCode).toBe(200);
    expect(v.json().version.body).toBe("<p>hello</p>");
  });

  it("validates input and 404s for missing pages/versions", async () => {
    const app = build();
    const MISSING = "99999999-9999-9999-9999-999999999999";
    expect((await createPage(app, { title: "" })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: `/pages/${MISSING}`, headers: H })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "PATCH", url: `/pages/${MISSING}`, headers: H, payload: { title: "x" } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: `/pages/${MISSING}/publish`, headers: H, payload: {} })).statusCode,
    ).toBe(404);

    // page exists but no such version → 404
    const pageId = (await createPage(app, {})).json().page.id;
    expect(
      (await app.inject({ method: "GET", url: `/pages/${pageId}/versions/${MISSING}`, headers: H })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: `/pages/${pageId}/publish`, headers: H, payload: { versionId: MISSING } })).statusCode,
    ).toBe(404);
  });

  it("requires a tenant (400 when x-tenant-id is missing)", async () => {
    const app = build();
    const res = await app.inject({ method: "GET", url: `/courses/${COURSE}/pages` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });

  it("never exposes another tenant's pages or versions", async () => {
    const app = build();
    const created = await createPage(app, { title: "Secret", body: "<p>x</p>" });
    const pageId = created.json().page.id;
    const versionId = (await app.inject({ method: "GET", url: `/pages/${pageId}/versions`, headers: H }))
      .json()
      .versions[0].id;

    // tenant B sees no pages and cannot read tenant A's page or version
    const otherList = await app.inject({
      method: "GET",
      url: `/courses/${COURSE}/pages`,
      headers: OTHER_H,
    });
    expect(otherList.json().pages).toHaveLength(0);
    expect(
      (await app.inject({ method: "GET", url: `/pages/${pageId}`, headers: OTHER_H })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `/pages/${pageId}/versions/${versionId}`, headers: OTHER_H })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: `/pages/${pageId}/publish`, headers: OTHER_H, payload: {} })).statusCode,
    ).toBe(404);
  });
});
