import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

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
const LEARNER = "a0000000-0000-0000-0000-000000000001";

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="M-1" version="1.0"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>Safety 101</title>
      <item identifier="I-1" identifierref="R-1">
        <title>Lesson 1</title>
        <adlcp:masteryscore>80</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="R-1" href="index.html"><file href="index.html"/></resource>
  </resources>
</manifest>`;

async function importPackage(
  app: ReturnType<typeof build>,
  headers = H,
  blobUrl = "https://blob.local/scorm/pkg.zip",
) {
  return app.inject({
    method: "POST",
    url: "/scorm/packages",
    headers,
    payload: { manifestXml: MANIFEST, blobUrl },
  });
}

describe("content: SCORM import (#31)", () => {
  it("imports a package and returns launch info on GET", async () => {
    const app = build();
    const res = await importPackage(app);
    expect(res.statusCode).toBe(201);
    const pkg = res.json().package;
    expect(pkg).toMatchObject({
      version: "1.2",
      title: "Safety 101",
      launchHref: "index.html",
      blobUrl: "https://blob.local/scorm/pkg.zip",
    });
    expect(pkg.masteryScore).toBeCloseTo(0.8);

    const got = await app.inject({
      method: "GET",
      url: `/scorm/packages/${pkg.id}`,
      headers: H,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().package).toMatchObject({
      id: pkg.id,
      launchHref: "index.html",
      version: "1.2",
    });
  });

  it("rejects a missing manifestXml or blobUrl with 400", async () => {
    const app = build();
    const noXml = await app.inject({
      method: "POST",
      url: "/scorm/packages",
      headers: H,
      payload: { blobUrl: "https://blob.local/x.zip" },
    });
    expect(noXml.statusCode).toBe(400);
    const noBlob = await app.inject({
      method: "POST",
      url: "/scorm/packages",
      headers: H,
      payload: { manifestXml: MANIFEST },
    });
    expect(noBlob.statusCode).toBe(400);
  });

  it("rejects an unsafe launch href with 400 unsafe_href", async () => {
    const app = build();
    const evil = MANIFEST.replace("index.html", "../../etc/passwd");
    const res = await app.inject({
      method: "POST",
      url: "/scorm/packages",
      headers: H,
      payload: { manifestXml: evil, blobUrl: "https://blob.local/x.zip" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unsafe_href");
  });

  it("rejects DOCTYPE manifests with 400 invalid_manifest", async () => {
    const app = build();
    const xxe = `<!DOCTYPE x><manifest/>`;
    const res = await app.inject({
      method: "POST",
      url: "/scorm/packages",
      headers: H,
      payload: { manifestXml: xxe, blobUrl: "https://blob.local/x.zip" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_manifest");
  });

  it("returns 404 for an unknown package", async () => {
    const app = build();
    const res = await app.inject({
      method: "GET",
      url: "/scorm/packages/b0000000-0000-0000-0000-0000000000ff",
      headers: H,
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires a tenant (400 when x-tenant-id missing)", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/scorm/packages",
      payload: { manifestXml: MANIFEST, blobUrl: "https://blob.local/x.zip" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });
});

describe("content: SCORM runtime (#31)", () => {
  it("saves completion/score and reads it back (round-trip)", async () => {
    const app = build();
    const pkg = (await importPackage(app)).json().package;

    const put = await app.inject({
      method: "PUT",
      url: `/scorm/packages/${pkg.id}/runtime`,
      headers: H,
      payload: {
        learnerId: LEARNER,
        lessonStatus: "passed",
        scoreRaw: 90,
        scoreMax: 100,
        sessionTime: "00:12:34",
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().attempt).toMatchObject({
      learnerId: LEARNER,
      completionStatus: "completed",
      successStatus: "passed",
      lessonStatus: "passed",
    });
    expect(put.json().attempt.scoreScaled).toBeCloseTo(0.9);

    const got = await app.inject({
      method: "GET",
      url: `/scorm/packages/${pkg.id}/runtime?learnerId=${LEARNER}`,
      headers: H,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().attempt).toMatchObject({
      completionStatus: "completed",
      successStatus: "passed",
    });
  });

  it("upserts (a second PUT updates the same attempt)", async () => {
    const app = build();
    const pkg = (await importPackage(app)).json().package;
    const first = await app.inject({
      method: "PUT",
      url: `/scorm/packages/${pkg.id}/runtime`,
      headers: H,
      payload: { learnerId: LEARNER, lessonStatus: "incomplete" },
    });
    const second = await app.inject({
      method: "PUT",
      url: `/scorm/packages/${pkg.id}/runtime`,
      headers: H,
      payload: { learnerId: LEARNER, lessonStatus: "passed" },
    });
    expect(first.json().attempt.id).toBe(second.json().attempt.id);
    expect(second.json().attempt.completionStatus).toBe("completed");
  });

  it("returns null attempt when none recorded yet", async () => {
    const app = build();
    const pkg = (await importPackage(app)).json().package;
    const got = await app.inject({
      method: "GET",
      url: `/scorm/packages/${pkg.id}/runtime?learnerId=${LEARNER}`,
      headers: H,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().attempt).toBeNull();
  });

  it("requires learnerId (400)", async () => {
    const app = build();
    const pkg = (await importPackage(app)).json().package;
    const put = await app.inject({
      method: "PUT",
      url: `/scorm/packages/${pkg.id}/runtime`,
      headers: H,
      payload: {},
    });
    expect(put.statusCode).toBe(400);
    const get = await app.inject({
      method: "GET",
      url: `/scorm/packages/${pkg.id}/runtime`,
      headers: H,
    });
    expect(get.statusCode).toBe(400);
  });

  it("returns 404 on runtime save for an unknown package", async () => {
    const app = build();
    const put = await app.inject({
      method: "PUT",
      url: "/scorm/packages/b0000000-0000-0000-0000-0000000000ff/runtime",
      headers: H,
      payload: { learnerId: LEARNER, lessonStatus: "passed" },
    });
    expect(put.statusCode).toBe(404);
  });
});

describe("content: SCORM tenant isolation (#31)", () => {
  it("a second tenant cannot read another tenant's package", async () => {
    const app = build();
    const pkg = (await importPackage(app)).json().package;
    const cross = await app.inject({
      method: "GET",
      url: `/scorm/packages/${pkg.id}`,
      headers: OTHER_H,
    });
    expect(cross.statusCode).toBe(404);
  });

  it("a second tenant cannot read another tenant's attempt", async () => {
    const app = build();
    const pkg = (await importPackage(app)).json().package;
    await app.inject({
      method: "PUT",
      url: `/scorm/packages/${pkg.id}/runtime`,
      headers: H,
      payload: { learnerId: LEARNER, lessonStatus: "passed" },
    });
    // The other tenant cannot even resolve the package → 404.
    const cross = await app.inject({
      method: "GET",
      url: `/scorm/packages/${pkg.id}/runtime?learnerId=${LEARNER}`,
      headers: OTHER_H,
    });
    expect(cross.statusCode).toBe(404);
  });
});
