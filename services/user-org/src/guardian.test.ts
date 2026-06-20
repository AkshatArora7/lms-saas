import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { MemoryConsentStore } from "./consent.memory.js";
import { evaluateGuardianConsent } from "./guardian.js";
import { MemoryGuardianStore } from "./guardian.memory.js";
import { buildApp } from "./main.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const GUARDIAN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STUDENT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STRANGER = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const GUARDIAN_EMAIL = "parent@example.com";

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

function build() {
  return buildApp({
    config,
    consentStore: new MemoryConsentStore(),
    guardianStore: new MemoryGuardianStore(),
    resolveTenant,
  });
}

const H = { "x-tenant-id": TENANT };
const OTHER_H = { "x-tenant-id": OTHER };

function grantDirectory(subjectUserId: string, ageBand = "under_13") {
  return {
    subjectUserId,
    ageBand,
    consentType: "directory_information",
    status: "granted",
    method: "verifiable_email",
    guardianEmail: GUARDIAN_EMAIL,
    guardianName: "Pat Guardian",
  };
}

async function createLink(app: ReturnType<typeof build>, headers = H, body = {}) {
  return app.inject({
    method: "POST",
    url: "/guardians",
    headers,
    payload: { guardianUserId: GUARDIAN, studentUserId: STUDENT, ...body },
  });
}

describe("guardian consent gate (pure)", () => {
  it("adults are never consent-gated", () => {
    const { consentSatisfied } = evaluateGuardianConsent({
      studentUserId: STUDENT,
      ageBand: "adult",
      category: "directory_information",
      grantedConsents: [],
    });
    expect(consentSatisfied).toBe(true);
  });

  it("minors require the gating consent granted", () => {
    expect(
      evaluateGuardianConsent({
        studentUserId: STUDENT,
        ageBand: "under_13",
        category: "directory_information",
        grantedConsents: [],
      }).consentSatisfied,
    ).toBe(false);
    expect(
      evaluateGuardianConsent({
        studentUserId: STUDENT,
        ageBand: "under_13",
        category: "directory_information",
        grantedConsents: ["directory_information"],
      }).consentSatisfied,
    ).toBe(true);
  });
});

describe("guardian relationships (#24)", () => {
  it("health still reports ok", async () => {
    const res = await build().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("user-org");
  });

  // AC1: relationship modeled — create + list both directions.
  it("creates a pending link and lists it both directions", async () => {
    const app = build();
    const created = await createLink(app);
    expect(created.statusCode).toBe(201);
    expect(created.json().relationship).toMatchObject({
      guardianUserId: GUARDIAN,
      studentUserId: STUDENT,
      status: "pending",
      relationship: "guardian",
    });

    const byStudent = await app.inject({
      method: "GET",
      url: `/students/${STUDENT}/guardians`,
      headers: H,
    });
    expect(byStudent.json().guardians).toHaveLength(1);

    const byGuardian = await app.inject({
      method: "GET",
      url: `/guardians/${GUARDIAN}/students`,
      headers: H,
    });
    expect(byGuardian.json().students).toHaveLength(1);
  });

  it("rejects a self-link (400) and a duplicate (409)", async () => {
    const app = build();
    const selfLink = await app.inject({
      method: "POST",
      url: "/guardians",
      headers: H,
      payload: { guardianUserId: GUARDIAN, studentUserId: GUARDIAN },
    });
    expect(selfLink.statusCode).toBe(400);
    expect(selfLink.json().error).toBe("self_link");

    expect((await createLink(app)).statusCode).toBe(201);
    const dup = await createLink(app);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("link_exists");
  });

  it("404s when a linked user does not exist", async () => {
    const app = buildApp({
      config,
      consentStore: new MemoryConsentStore(),
      // Only GUARDIAN + STUDENT exist in this tenant.
      guardianStore: new MemoryGuardianStore(
        (_ctx, userId) => userId === GUARDIAN || userId === STUDENT,
      ),
      resolveTenant,
    });
    const missing = await app.inject({
      method: "POST",
      url: "/guardians",
      headers: H,
      payload: { guardianUserId: GUARDIAN, studentUserId: STRANGER },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("not_found");
  });

  it("validates input (400 on non-uuid)", async () => {
    const app = build();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/guardians",
          headers: H,
          payload: { guardianUserId: "nope", studentUserId: STUDENT },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/guardians/authorize?guardianUserId=nope&studentUserId=" + STUDENT,
          headers: H,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("requires a tenant (400 without x-tenant-id)", async () => {
    const app = build();
    const res = await app.inject({ method: "POST", url: "/guardians", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });

  // AC3: consent/age rules — activate blocked without consent, allowed with it.
  it("blocks activation without consent and allows it once granted", async () => {
    const app = build();
    const link = (await createLink(app)).json().relationship;

    // No consent on file for a minor → activation denied.
    await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: {
        subjectUserId: STUDENT,
        ageBand: "under_13",
        consentType: "directory_information",
        status: "pending",
      },
    });
    const denied = await app.inject({
      method: "POST",
      url: `/guardians/${link.id}/activate`,
      headers: H,
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error).toBe("consent_required");

    // Grant verifiable parental consent → activation succeeds.
    await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantDirectory(STUDENT),
    });
    const activated = await app.inject({
      method: "POST",
      url: `/guardians/${link.id}/activate`,
      headers: H,
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().relationship.status).toBe("active");
    expect(activated.json().relationship.consentId).not.toBeNull();
  });

  it("404s activating/revoking an unknown relationship", async () => {
    const app = build();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/guardians/${OTHER}/activate`,
          headers: H,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/guardians/${OTHER}/revoke`,
          headers: H,
        })
      ).statusCode,
    ).toBe(404);
  });

  // AC2: read-only scoped access — authorize true only for active+consented.
  it("authorize is true only for an active, consented guardian", async () => {
    const app = build();
    const link = (await createLink(app)).json().relationship;

    // Pending relationship → not authorized.
    const pending = await app.inject({
      method: "GET",
      url: `/guardians/authorize?guardianUserId=${GUARDIAN}&studentUserId=${STUDENT}`,
      headers: H,
    });
    expect(pending.json().decision.allowed).toBe(false);
    expect(pending.json().decision.relationshipStatus).toBe("pending");

    // Grant consent + activate.
    await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantDirectory(STUDENT),
    });
    await app.inject({
      method: "POST",
      url: `/guardians/${link.id}/activate`,
      headers: H,
    });

    const ok = await app.inject({
      method: "GET",
      url: `/guardians/authorize?guardianUserId=${GUARDIAN}&studentUserId=${STUDENT}`,
      headers: H,
    });
    expect(ok.json().decision.allowed).toBe(true);
    expect(ok.json().decision.consentSatisfied).toBe(true);

    // A stranger guardian is never authorized.
    const stranger = await app.inject({
      method: "GET",
      url: `/guardians/authorize?guardianUserId=${STRANGER}&studentUserId=${STUDENT}`,
      headers: H,
    });
    expect(stranger.json().decision.allowed).toBe(false);
    expect(stranger.json().decision.relationshipStatus).toBe("none");
  });

  it("revoking the student's consent denies authorize immediately", async () => {
    const app = build();
    const link = (await createLink(app)).json().relationship;
    const consent = await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantDirectory(STUDENT),
    });
    await app.inject({
      method: "POST",
      url: `/guardians/${link.id}/activate`,
      headers: H,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/guardians/authorize?guardianUserId=${GUARDIAN}&studentUserId=${STUDENT}`,
          headers: H,
        })
      ).json().decision.allowed,
    ).toBe(true);

    // Revoke the underlying consent → predicate flips to deny, relationship untouched.
    await app.inject({
      method: "POST",
      url: `/compliance/consents/${consent.json().consent.id}/revoke`,
      headers: H,
    });
    const after = await app.inject({
      method: "GET",
      url: `/guardians/authorize?guardianUserId=${GUARDIAN}&studentUserId=${STUDENT}`,
      headers: H,
    });
    expect(after.json().decision.allowed).toBe(false);
    expect(after.json().decision.relationshipStatus).toBe("active");
    expect(after.json().decision.consentSatisfied).toBe(false);
  });

  it("revoking the relationship denies authorize", async () => {
    const app = build();
    const link = (await createLink(app)).json().relationship;
    await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: grantDirectory(STUDENT),
    });
    await app.inject({
      method: "POST",
      url: `/guardians/${link.id}/activate`,
      headers: H,
    });
    const revoked = await app.inject({
      method: "POST",
      url: `/guardians/${link.id}/revoke`,
      headers: H,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().relationship.status).toBe("revoked");

    const after = await app.inject({
      method: "GET",
      url: `/guardians/authorize?guardianUserId=${GUARDIAN}&studentUserId=${STUDENT}`,
      headers: H,
    });
    expect(after.json().decision.allowed).toBe(false);
  });

  it("activates an adult student's link without a consent row", async () => {
    const app = build();
    const link = (await createLink(app)).json().relationship;
    // Record an adult age band, no granted directory_information consent.
    await app.inject({
      method: "POST",
      url: "/compliance/consents",
      headers: H,
      payload: {
        subjectUserId: STUDENT,
        ageBand: "adult",
        consentType: "directory_information",
        status: "pending",
      },
    });
    const activated = await app.inject({
      method: "POST",
      url: `/guardians/${link.id}/activate`,
      headers: H,
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().relationship.status).toBe("active");
  });

  // AC2: tenant isolation — a second tenant sees nothing, and has no write path.
  it("isolates relationships by tenant", async () => {
    const app = build();
    await createLink(app);
    const mine = await app.inject({
      method: "GET",
      url: `/students/${STUDENT}/guardians`,
      headers: H,
    });
    expect(mine.json().guardians).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: `/students/${STUDENT}/guardians`,
      headers: OTHER_H,
    });
    expect(theirs.json().guardians).toHaveLength(0);
  });

  it("exposes no guardian write path to child data (only the read predicate)", async () => {
    const app = build();
    // The guardian-facing surface is read-only: there is no route to mutate a
    // student's data. Probe would-be write paths → 404 (no such route).
    for (const url of [
      `/students/${STUDENT}/grades`,
      `/guardians/${GUARDIAN}/students/${STUDENT}/grades`,
    ]) {
      const res = await app.inject({ method: "POST", url, headers: H, payload: {} });
      expect(res.statusCode).toBe(404);
    }
    // The only guardian-facing route is the read-only predicate.
    const authorize = await app.inject({
      method: "GET",
      url: `/guardians/authorize?guardianUserId=${GUARDIAN}&studentUserId=${STUDENT}`,
      headers: H,
    });
    expect(authorize.statusCode).toBe(200);
  });
});
