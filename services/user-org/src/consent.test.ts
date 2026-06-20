import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { dataCollectionDecision, isMinor } from "./consent.js";
import { MemoryConsentStore } from "./consent.memory.js";
import { buildApp } from "./main.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MINOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUARDIAN_EMAIL = "parent@example.com";

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

function build() {
  return buildApp({ config, consentStore: new MemoryConsentStore(), resolveTenant });
}

const H = { "x-tenant-id": TENANT };
const OTHER_H = { "x-tenant-id": OTHER };

function grantUnder13(consentType: string, extra: Record<string, unknown> = {}) {
  return {
    subjectUserId: MINOR,
    ageBand: "under_13",
    consentType,
    status: "granted",
    method: "verifiable_email",
    guardianEmail: GUARDIAN_EMAIL,
    guardianName: "Pat Guardian",
    ...extra,
  };
}

describe("consent policy (pure)", () => {
  it("flags school-age minors", () => {
    expect(isMinor("under_13")).toBe(true);
    expect(isMinor("13_17")).toBe(true);
    expect(isMinor("adult")).toBe(false);
    expect(isMinor("unknown")).toBe(false);
  });

  it("under-13 needs consent for every category", () => {
    const blocked = dataCollectionDecision({
      subjectUserId: MINOR,
      ageBand: "under_13",
      category: "data_collection",
      grantedConsents: [],
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiresConsent).toBe(true);

    const allowed = dataCollectionDecision({
      subjectUserId: MINOR,
      ageBand: "under_13",
      category: "data_collection",
      grantedConsents: ["data_collection"],
    });
    expect(allowed.allowed).toBe(true);
  });

  it("13-17 allows basic collection but gates sharing/AI", () => {
    expect(
      dataCollectionDecision({
        subjectUserId: MINOR,
        ageBand: "13_17",
        category: "data_collection",
        grantedConsents: [],
      }).allowed,
    ).toBe(true);
    expect(
      dataCollectionDecision({
        subjectUserId: MINOR,
        ageBand: "13_17",
        category: "third_party_sharing",
        grantedConsents: [],
      }).allowed,
    ).toBe(false);
  });

  it("adults are never age-gated", () => {
    const d = dataCollectionDecision({
      subjectUserId: MINOR,
      ageBand: "adult",
      category: "ai_features",
      grantedConsents: [],
    });
    expect(d.allowed).toBe(true);
    expect(d.requiresConsent).toBe(false);
  });
});

describe("compliance surface (#77)", () => {
  it("health still reports ok", async () => {
    const res = await build().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("user-org");
  });

  it("captures consent and enforces it via the data-policy endpoint", async () => {
    const app = build();
    // Before consent: under-13 data collection is blocked.
    await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: { subjectUserId: MINOR, ageBand: "under_13", consentType: "data_collection", status: "pending" },
    });
    const before = await app.inject({
      method: "GET",
      url: `/compliance/subjects/${MINOR}/data-policy?category=data_collection`,
      headers: H,
    });
    expect(before.json().decision.allowed).toBe(false);

    // Grant verifiable parental consent.
    const grant = await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantUnder13("data_collection"),
    });
    expect(grant.statusCode).toBe(201);
    expect(grant.json().consent).toMatchObject({ status: "granted", ageBand: "under_13" });

    const after = await app.inject({
      method: "GET",
      url: `/compliance/subjects/${MINOR}/data-policy?category=data_collection`,
      headers: H,
    });
    expect(after.json().decision.allowed).toBe(true);
  });

  it("rejects granting under-13 consent without a verifiable method + guardian", async () => {
    const app = build();
    const bad = await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: { subjectUserId: MINOR, ageBand: "under_13", consentType: "data_collection", status: "granted" },
    });
    expect(bad.statusCode).toBe(400);

    const badMethod = await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantUnder13("data_collection", { method: "none" }),
    });
    expect(badMethod.statusCode).toBe(400);
  });

  it("validates input", async () => {
    const app = build();
    expect(
      (await app.inject({ method: "POST", url: "/compliance/consents", headers: H, payload: { subjectUserId: "not-a-uuid", ageBand: "adult", consentType: "data_collection" } })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/compliance/consents", headers: H, payload: { subjectUserId: MINOR, ageBand: "old", consentType: "data_collection" } })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: `/compliance/subjects/${MINOR}/data-policy?category=bogus`, headers: H })).statusCode,
    ).toBe(400);
  });

  it("revokes consent and re-blocks collection", async () => {
    const app = build();
    const granted = await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantUnder13("data_collection"),
    });
    const id = granted.json().consent.id;

    const revoke = await app.inject({
      method: "POST",
      url: `/compliance/consents/${id}/revoke`,
      headers: H,
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().consent.status).toBe("revoked");

    const policy = await app.inject({
      method: "GET",
      url: `/compliance/subjects/${MINOR}/data-policy?category=data_collection`,
      headers: H,
    });
    expect(policy.json().decision.allowed).toBe(false);

    // 404 revoking an unknown consent.
    expect(
      (await app.inject({ method: "POST", url: `/compliance/consents/${OTHER}/revoke`, headers: H })).statusCode,
    ).toBe(404);
  });

  it("isolates consents by tenant", async () => {
    const app = build();
    await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantUnder13("data_collection"),
    });
    const mine = await app.inject({
      method: "GET",
      url: `/compliance/subjects/${MINOR}/consents`,
      headers: H,
    });
    expect(mine.json().consents).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: `/compliance/subjects/${MINOR}/consents`,
      headers: OTHER_H,
    });
    expect(theirs.json().consents).toHaveLength(0);
  });
});
