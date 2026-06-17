import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  PolicyInput,
  RequestStatus,
  SelfRegistrationStore,
} from "./selfreg.js";

export interface SelfRegRouteDeps {
  store: SelfRegistrationStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: SelfRegRouteDeps,
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
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isStatus(v: unknown): v is RequestStatus {
  return v === "pending" || v === "approved" || v === "denied";
}

/** Register the self-registration surface: policy, self-register, approvals. */
export function registerSelfRegRoutes(
  app: FastifyInstance,
  deps: SelfRegRouteDeps,
): void {
  app.put<{ Params: { orgUnitId: string } }>(
    "/sections/:orgUnitId/registration-policy",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        isOpen?: unknown;
        requiresApproval?: unknown;
        capacity?: unknown;
      };
      const patch: PolicyInput = {};
      if (body.isOpen !== undefined) {
        if (typeof body.isOpen !== "boolean") {
          return badRequest(reply, "isOpen must be a boolean.");
        }
        patch.isOpen = body.isOpen;
      }
      if (body.requiresApproval !== undefined) {
        if (typeof body.requiresApproval !== "boolean") {
          return badRequest(reply, "requiresApproval must be a boolean.");
        }
        patch.requiresApproval = body.requiresApproval;
      }
      if (body.capacity !== undefined) {
        if (
          body.capacity !== null &&
          (typeof body.capacity !== "number" ||
            !Number.isInteger(body.capacity) ||
            body.capacity < 0)
        ) {
          return badRequest(reply, "capacity must be a non-negative integer or null.");
        }
        patch.capacity = body.capacity as number | null;
      }
      const policy = await deps.store.setPolicy(ctx, req.params.orgUnitId, patch);
      return reply.code(200).send({ policy });
    },
  );

  app.get<{ Params: { orgUnitId: string } }>(
    "/sections/:orgUnitId/registration-policy",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const policy = await deps.store.getPolicy(ctx, req.params.orgUnitId);
      if (!policy) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No registration policy set." });
      }
      return reply.code(200).send({ policy });
    },
  );

  app.post<{ Params: { orgUnitId: string } }>(
    "/sections/:orgUnitId/self-register",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { userId?: unknown };
      if (!isNonEmptyString(body.userId)) {
        return badRequest(reply, "userId is required.");
      }
      const result = await deps.store.selfRegister(
        ctx,
        req.params.orgUnitId,
        body.userId.trim(),
      );
      if (!result.ok) {
        if (result.reason === "closed") {
          return reply
            .code(403)
            .send({ error: "closed", message: "Self-registration is not open for this section." });
        }
        if (result.reason === "already_enrolled") {
          return reply
            .code(409)
            .send({ error: "already_enrolled", message: "Already enrolled in this section." });
        }
        return badRequest(reply, "No 'learner' role configured for this tenant.");
      }
      // 201 enrolled, 202 pending (accepted, awaiting approval/seat).
      return reply
        .code(result.outcome === "enrolled" ? 201 : 202)
        .send({ outcome: result.outcome, request: result.request });
    },
  );

  app.get<{
    Params: { orgUnitId: string };
    Querystring: { status?: string };
  }>("/sections/:orgUnitId/registration-requests", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const { status } = req.query;
    if (status !== undefined && !isStatus(status)) {
      return badRequest(reply, "Invalid status filter.");
    }
    const requests = await deps.store.listRequests(
      ctx,
      req.params.orgUnitId,
      isStatus(status) ? status : undefined,
    );
    return reply.code(200).send({ requests });
  });

  app.post<{ Params: { id: string } }>(
    "/registration-requests/:id/decide",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { decision?: unknown; decidedBy?: unknown };
      if (body.decision !== "approve" && body.decision !== "deny") {
        return badRequest(reply, "decision must be 'approve' or 'deny'.");
      }
      const result = await deps.store.decide(
        ctx,
        req.params.id,
        body.decision,
        isNonEmptyString(body.decidedBy) ? body.decidedBy.trim() : null,
      );
      if (!result.ok) {
        if (result.reason === "not_found") {
          return reply.code(404).send({ error: "not_found", message: "Request not found." });
        }
        if (result.reason === "not_pending") {
          return reply.code(409).send({ error: "not_pending", message: "Request already decided." });
        }
        if (result.reason === "at_capacity") {
          return reply.code(409).send({ error: "at_capacity", message: "Section is at capacity." });
        }
        return badRequest(reply, "No 'learner' role configured for this tenant.");
      }
      return reply.code(200).send({ outcome: result.outcome, request: result.request });
    },
  );
}
