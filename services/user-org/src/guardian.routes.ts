import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  CONSENT_TYPES,
  type ConsentStore,
  type ConsentType,
} from "./consent.js";
import {
  evaluateGuardianConsent,
  GUARDIAN_CONSENT_CATEGORY,
  GUARDIAN_KINDS,
  type GuardianKind,
  type GuardianStore,
} from "./guardian.js";

export interface GuardianRouteDeps {
  store: GuardianStore;
  /** Reused for the consent/age gate — no consent logic is duplicated here. */
  consentStore: ConsentStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveTenantOr400(
  deps: GuardianRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): TenantContext | null {
  try {
    return deps.resolveTenant(req);
  } catch {
    void reply
      .code(400)
      .send({ error: "tenant_required", message: "Missing tenant context." });
    return null;
  }
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: "not_found", message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const isGuardianKind = (v: unknown): v is GuardianKind =>
  typeof v === "string" && (GUARDIAN_KINDS as readonly string[]).includes(v);
const isConsentType = (v: unknown): v is ConsentType =>
  typeof v === "string" && (CONSENT_TYPES as readonly string[]).includes(v);

/**
 * Resolve the student's age band + the consent decision for `category` from the
 * existing ConsentStore (live, re-derived per request). Returns the granted
 * gating consent id for provenance stamping when present.
 */
async function gateFor(
  deps: GuardianRouteDeps,
  ctx: TenantContext,
  studentUserId: string,
  category: ConsentType,
) {
  const [ageBand, consents] = await Promise.all([
    deps.consentStore.getAgeBand(ctx, studentUserId),
    deps.consentStore.listConsents(ctx, studentUserId),
  ]);
  const granted = consents.filter((c) => c.status === "granted");
  const grantedConsents = granted.map((c) => c.consentType);
  const { consentSatisfied, decision } = evaluateGuardianConsent({
    studentUserId,
    ageBand,
    category,
    grantedConsents,
  });
  const gatingConsentId =
    granted.find((c) => c.consentType === category)?.id ?? null;
  return { ageBand, consentSatisfied, decision, gatingConsentId };
}

/**
 * Guardian/parent relationships (issue #24). Link a guardian app_user to a
 * student app_user with a read-only, consent-gated relationship.
 *
 * READ-ONLY by construction: the only guardian-facing route is the read-only
 * `GET /guardians/authorize` predicate. Create/activate/revoke are admin/staff
 * operations — there is no write path to the child's data.
 *
 * NOTE: this service does not yet carry a role/permission guard (the gateway
 * authenticates and forwards `x-tenant-id`; other admin surfaces here, e.g.
 * `routes.ts` org-unit/role management, are likewise unguarded at this layer).
 * TODO(#24-followup): when a service-level authz guard lands, restrict the four
 * mutation routes below to admin/staff and keep `/guardians/authorize` public
 * to internal callers — consistent with the rest of this service.
 */
export function registerGuardianRoutes(
  app: FastifyInstance,
  deps: GuardianRouteDeps,
): void {
  // 1. Create a link (admin/staff). Starts status='pending'.
  app.post("/guardians", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      guardianUserId?: unknown;
      studentUserId?: unknown;
      relationship?: unknown;
      note?: unknown;
      createdBy?: unknown;
    };

    if (!isNonEmptyString(body.guardianUserId) || !UUID_RE.test(body.guardianUserId)) {
      return badRequest(reply, "guardianUserId must be a uuid.");
    }
    if (!isNonEmptyString(body.studentUserId) || !UUID_RE.test(body.studentUserId)) {
      return badRequest(reply, "studentUserId must be a uuid.");
    }
    if (body.guardianUserId === body.studentUserId) {
      return reply.code(400).send({
        error: "self_link",
        message: "A user cannot be their own guardian.",
      });
    }
    if (body.relationship !== undefined && !isGuardianKind(body.relationship)) {
      return badRequest(
        reply,
        `relationship must be one of: ${GUARDIAN_KINDS.join(", ")}.`,
      );
    }
    if (body.createdBy !== undefined && body.createdBy !== null) {
      if (!isNonEmptyString(body.createdBy) || !UUID_RE.test(body.createdBy)) {
        return badRequest(reply, "createdBy must be a uuid.");
      }
    }

    const result = await deps.store.createRelationship(ctx, {
      guardianUserId: body.guardianUserId,
      studentUserId: body.studentUserId,
      ...(isGuardianKind(body.relationship) ? { relationship: body.relationship } : {}),
      ...(isNonEmptyString(body.note) ? { note: body.note.trim() } : {}),
      ...(isNonEmptyString(body.createdBy) ? { createdBy: body.createdBy } : {}),
    });
    if (!result.ok) {
      if (result.reason === "link_exists") {
        return reply.code(409).send({
          error: "link_exists",
          message: "This guardian is already linked to this student.",
        });
      }
      return notFound(
        reply,
        result.reason === "guardian_not_found"
          ? "Guardian user not found."
          : "Student user not found.",
      );
    }
    return reply.code(201).send({ relationship: result.relationship });
  });

  // 2. List a student's guardians.
  app.get<{ Params: { studentId: string } }>(
    "/students/:studentId/guardians",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.studentId)) {
        return badRequest(reply, "studentId must be a uuid.");
      }
      const guardians = await deps.store.listGuardiansForStudent(
        ctx,
        req.params.studentId,
      );
      return reply.code(200).send({ guardians });
    },
  );

  // 3. List a guardian's students.
  app.get<{ Params: { guardianId: string } }>(
    "/guardians/:guardianId/students",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.guardianId)) {
        return badRequest(reply, "guardianId must be a uuid.");
      }
      const students = await deps.store.listStudentsForGuardian(
        ctx,
        req.params.guardianId,
      );
      return reply.code(200).send({ students });
    },
  );

  // 3b. List a guardian's *authorized* children: active links whose gating
  //     consent (directory_information) is currently satisfied. This is the
  //     consent-filtered read other services (e.g. attendance's guardian-scoped
  //     view, #190) depend on — it never returns pending/revoked links nor
  //     non-consented minors. Consent is re-derived live per request via
  //     gateFor, so a consent revoke drops the child immediately.
  app.get<{ Params: { guardianId: string } }>(
    "/guardians/:guardianId/children/authorized",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.guardianId)) {
        return badRequest(reply, "guardianId must be a uuid.");
      }
      const relationships = await deps.store.listStudentsForGuardian(
        ctx,
        req.params.guardianId,
      );
      const active = relationships.filter((r) => r.status === "active");
      const gated = await Promise.all(
        active.map(async (r) => {
          const { consentSatisfied } = await gateFor(
            deps,
            ctx,
            r.studentUserId,
            GUARDIAN_CONSENT_CATEGORY,
          );
          return consentSatisfied
            ? {
                studentUserId: r.studentUserId,
                relationship: r.relationship,
              }
            : null;
        }),
      );
      const children = gated.filter(
        (c): c is { studentUserId: string; relationship: GuardianKind } =>
          c !== null,
      );
      return reply.code(200).send({ children });
    },
  );

  // 4. Activate a pending link (admin/staff). Server re-checks the consent gate.
  app.post<{ Params: { id: string } }>(
    "/guardians/:id/activate",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.id)) {
        return badRequest(reply, "guardian relationship id must be a uuid.");
      }
      const existing = await deps.store.getRelationshipById(ctx, req.params.id);
      if (!existing) {
        return notFound(reply, "Guardian relationship not found.");
      }

      const { consentSatisfied, decision, gatingConsentId } = await gateFor(
        deps,
        ctx,
        existing.studentUserId,
        GUARDIAN_CONSENT_CATEGORY,
      );
      if (!consentSatisfied) {
        return reply.code(409).send({
          error: "consent_required",
          message:
            "Cannot activate: the student's gating consent is not granted.",
          decision,
        });
      }

      const relationship = await deps.store.activateRelationship(
        ctx,
        req.params.id,
        gatingConsentId,
      );
      if (!relationship) return notFound(reply, "Guardian relationship not found.");
      return reply.code(200).send({ relationship });
    },
  );

  // 5. Soft-revoke a link (admin/staff).
  app.post<{ Params: { id: string } }>(
    "/guardians/:id/revoke",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.id)) {
        return badRequest(reply, "guardian relationship id must be a uuid.");
      }
      const relationship = await deps.store.revokeRelationship(ctx, req.params.id);
      if (!relationship) return notFound(reply, "Guardian relationship not found.");
      return reply.code(200).send({ relationship });
    },
  );

  // 6. READ-ONLY predicate: is G an active, consented guardian of S? Consent is
  //    re-derived live, so a consent revoke denies immediately.
  app.get<{
    Querystring: {
      guardianUserId?: string;
      studentUserId?: string;
      category?: string;
    };
  }>("/guardians/authorize", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const { guardianUserId, studentUserId } = req.query;
    if (!isNonEmptyString(guardianUserId) || !UUID_RE.test(guardianUserId)) {
      return badRequest(reply, "guardianUserId must be a uuid.");
    }
    if (!isNonEmptyString(studentUserId) || !UUID_RE.test(studentUserId)) {
      return badRequest(reply, "studentUserId must be a uuid.");
    }
    const category =
      req.query.category !== undefined
        ? req.query.category
        : GUARDIAN_CONSENT_CATEGORY;
    if (!isConsentType(category)) {
      return badRequest(
        reply,
        `category must be one of: ${CONSENT_TYPES.join(", ")}.`,
      );
    }

    const relationship = await deps.store.getRelationship(
      ctx,
      guardianUserId,
      studentUserId,
    );
    if (!relationship || relationship.status !== "active") {
      const ageBand = await deps.consentStore.getAgeBand(ctx, studentUserId);
      return reply.code(200).send({
        decision: {
          allowed: false,
          reason: relationship
            ? `Relationship is '${relationship.status}', not active.`
            : "No guardian relationship exists for this pair.",
          relationshipStatus: relationship ? relationship.status : "none",
          ageBand,
          consentSatisfied: false,
        },
      });
    }

    const { ageBand, consentSatisfied, decision } = await gateFor(
      deps,
      ctx,
      studentUserId,
      category,
    );
    const allowed = consentSatisfied;
    return reply.code(200).send({
      decision: {
        allowed,
        reason: allowed
          ? "Active guardian relationship and consent is satisfied."
          : decision.reason,
        relationshipStatus: relationship.status,
        ageBand,
        consentSatisfied,
      },
    });
  });
}
