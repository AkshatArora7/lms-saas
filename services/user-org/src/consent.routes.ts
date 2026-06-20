import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  AGE_BANDS,
  CONSENT_METHODS,
  CONSENT_STATUSES,
  CONSENT_TYPES,
  dataCollectionDecision,
  type AgeBand,
  type ConsentMethod,
  type ConsentStatus,
  type ConsentStore,
  type ConsentType,
} from "./consent.js";

export interface ConsentRouteDeps {
  store: ConsentStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveTenantOr400(
  deps: ConsentRouteDeps,
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
const isAgeBand = (v: unknown): v is AgeBand =>
  typeof v === "string" && (AGE_BANDS as readonly string[]).includes(v);
const isConsentType = (v: unknown): v is ConsentType =>
  typeof v === "string" && (CONSENT_TYPES as readonly string[]).includes(v);
const isConsentStatus = (v: unknown): v is ConsentStatus =>
  typeof v === "string" && (CONSENT_STATUSES as readonly string[]).includes(v);
const isConsentMethod = (v: unknown): v is ConsentMethod =>
  typeof v === "string" && (CONSENT_METHODS as readonly string[]).includes(v);

/**
 * Compliance surface (issue #77): capture/revoke parental consent and answer the
 * data-collection policy for a subject. Tenant comes from the gateway header.
 */
export function registerConsentRoutes(
  app: FastifyInstance,
  deps: ConsentRouteDeps,
): void {
  app.post("/compliance/consents", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as {
      subjectUserId?: unknown;
      ageBand?: unknown;
      consentType?: unknown;
      status?: unknown;
      guardianName?: unknown;
      guardianEmail?: unknown;
      method?: unknown;
      recordedBy?: unknown;
    };

    if (!isNonEmptyString(body.subjectUserId) || !UUID_RE.test(body.subjectUserId)) {
      return badRequest(reply, "subjectUserId must be a uuid.");
    }
    if (!isAgeBand(body.ageBand)) {
      return badRequest(reply, `ageBand must be one of: ${AGE_BANDS.join(", ")}.`);
    }
    if (!isConsentType(body.consentType)) {
      return badRequest(
        reply,
        `consentType must be one of: ${CONSENT_TYPES.join(", ")}.`,
      );
    }
    if (body.status !== undefined && !isConsentStatus(body.status)) {
      return badRequest(reply, "Invalid status.");
    }
    if (body.method !== undefined && body.method !== null && !isConsentMethod(body.method)) {
      return badRequest(reply, `method must be one of: ${CONSENT_METHODS.join(", ")}.`);
    }
    if (body.recordedBy !== undefined && body.recordedBy !== null) {
      if (!isNonEmptyString(body.recordedBy) || !UUID_RE.test(body.recordedBy)) {
        return badRequest(reply, "recordedBy must be a uuid.");
      }
    }

    // COPPA: granting consent for an under-13 subject demands a verifiable
    // method and a guardian on record — not a bare flag.
    const status = isConsentStatus(body.status) ? body.status : "pending";
    if (
      status === "granted" &&
      body.ageBand === "under_13" &&
      (!isConsentMethod(body.method) ||
        body.method === "none" ||
        !isNonEmptyString(body.guardianEmail))
    ) {
      return badRequest(
        reply,
        "Granting consent for an under-13 subject requires a verifiable method and a guardianEmail.",
      );
    }

    const consent = await deps.store.recordConsent(ctx, {
      subjectUserId: body.subjectUserId,
      ageBand: body.ageBand,
      consentType: body.consentType,
      status,
      ...(isNonEmptyString(body.guardianName)
        ? { guardianName: body.guardianName.trim() }
        : {}),
      ...(isNonEmptyString(body.guardianEmail)
        ? { guardianEmail: body.guardianEmail.trim() }
        : {}),
      ...(isConsentMethod(body.method) ? { method: body.method } : {}),
      ...(isNonEmptyString(body.recordedBy) ? { recordedBy: body.recordedBy } : {}),
    });
    return reply.code(201).send({ consent });
  });

  app.post<{ Params: { id: string } }>(
    "/compliance/consents/:id/revoke",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.id)) {
        return badRequest(reply, "consent id must be a uuid.");
      }
      const consent = await deps.store.revokeConsent(ctx, req.params.id);
      if (!consent) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Consent not found." });
      }
      return reply.code(200).send({ consent });
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/compliance/subjects/:userId/consents",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.userId)) {
        return badRequest(reply, "userId must be a uuid.");
      }
      const consents = await deps.store.listConsents(ctx, req.params.userId);
      return reply.code(200).send({ consents });
    },
  );

  // Enforcement point: may we collect/share `category` for this subject?
  app.get<{ Params: { userId: string }; Querystring: { category?: string } }>(
    "/compliance/subjects/:userId/data-policy",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!UUID_RE.test(req.params.userId)) {
        return badRequest(reply, "userId must be a uuid.");
      }
      if (!isConsentType(req.query.category)) {
        return badRequest(
          reply,
          `category must be one of: ${CONSENT_TYPES.join(", ")}.`,
        );
      }
      const [ageBand, consents] = await Promise.all([
        deps.store.getAgeBand(ctx, req.params.userId),
        deps.store.listConsents(ctx, req.params.userId),
      ]);
      const grantedConsents = consents
        .filter((c) => c.status === "granted")
        .map((c) => c.consentType);
      const decision = dataCollectionDecision({
        subjectUserId: req.params.userId,
        ageBand,
        category: req.query.category,
        grantedConsents,
      });
      return reply.code(200).send({ decision });
    },
  );
}
