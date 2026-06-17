import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { DEMO_TENANT_ID, MemoryAnnotationStore } from "./annotations.memory.js";
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

const SUB = "5b000000-0000-0000-0000-000000000001";
const LEARNER = "a0000000-0000-0000-0000-000000000009";

function build() {
  const annotationStore = new MemoryAnnotationStore();
  annotationStore.seedSubmission(DEMO_TENANT_ID, SUB, LEARNER);
  return { app: buildApp({ config, annotationStore, resolveTenant }), annotationStore };
}

const H = { "x-tenant-id": DEMO_TENANT_ID };

async function annotate(app: ReturnType<typeof build>["app"], body: string) {
  return app.inject({
    method: "POST",
    url: `/submissions/${SUB}/annotations`,
    headers: H,
    payload: { body, anchor: { page: 1, quote: "see here" } },
  });
}

describe("inline feedback & annotations (#38)", () => {
  it("adds an annotation to a submission and 404s an unknown submission", async () => {
    const { app } = build();
    const res = await annotate(app, "Cite your source.");
    expect(res.statusCode).toBe(201);
    expect(res.json().annotation).toMatchObject({
      body: "Cite your source.",
      released: false,
      anchor: { page: 1 },
    });

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/submissions/99999999-9999-9999-9999-999999999999/annotations`,
          headers: H,
          payload: { body: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: "POST", url: `/submissions/${SUB}/annotations`, headers: H, payload: {} })).statusCode).toBe(400);
  });

  it("hides unreleased feedback from the learner view until released", async () => {
    const { app } = build();
    await annotate(app, "Draft note");
    // Teacher view: all annotations.
    const all = await app.inject({
      method: "GET",
      url: `/submissions/${SUB}/annotations`,
      headers: H,
    });
    expect(all.json().annotations).toHaveLength(1);
    // Learner view (released only): nothing yet.
    const learner = await app.inject({
      method: "GET",
      url: `/submissions/${SUB}/annotations?released=true`,
      headers: H,
    });
    expect(learner.json().annotations).toHaveLength(0);
  });

  it("releases feedback (marks released, returns recipient) for notification", async () => {
    const { app } = build();
    await annotate(app, "Note 1");
    await annotate(app, "Note 2");
    const release = await app.inject({
      method: "POST",
      url: `/submissions/${SUB}/feedback/release`,
      headers: H,
    });
    expect(release.statusCode).toBe(200);
    expect(release.json()).toMatchObject({ released: 2, recipientId: LEARNER });

    // Now the learner can see them.
    const learner = await app.inject({
      method: "GET",
      url: `/submissions/${SUB}/annotations?released=true`,
      headers: H,
    });
    expect(learner.json().annotations).toHaveLength(2);
  });

  it("edits and deletes annotations; 404 for missing", async () => {
    const { app } = build();
    const id = (await annotate(app, "typo")).json().annotation.id;
    const patched = await app.inject({
      method: "PATCH",
      url: `/annotations/${id}`,
      headers: H,
      payload: { body: "Fix this typo" },
    });
    expect(patched.json().annotation.body).toBe("Fix this typo");
    expect(
      (await app.inject({ method: "DELETE", url: `/annotations/${id}`, headers: H }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "PATCH", url: `/annotations/${id}`, headers: H, payload: { body: "x" } }))
        .statusCode,
    ).toBe(404);
  });

  it("isolates annotations per tenant", async () => {
    const { app } = build();
    await annotate(app, "private");
    const other = await app.inject({
      method: "GET",
      url: `/submissions/${SUB}/annotations`,
      headers: { "x-tenant-id": OTHER.tenantId },
    });
    expect(other.json().annotations).toHaveLength(0);
  });
});
