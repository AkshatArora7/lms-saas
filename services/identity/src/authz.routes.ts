import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  checkAccess,
  effectivePermissions,
  type AuthzStore,
} from "./authz.js";

export interface AuthzRouteDeps {
  store: AuthzStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: AuthzRouteDeps,
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

/**
 * Org-scoped authorization surface (issue #18):
 * - GET /authz/check    — deny-by-default permission check at an org-unit scope,
 *   honouring cascade down the org subtree.
 * - GET /users/:id/effective-permissions — the user's effective grants (debug).
 */
export function registerAuthzRoutes(
  app: FastifyInstance,
  deps: AuthzRouteDeps,
): void {
  app.get<{
    Querystring: { userId?: string; permission?: string; orgUnitId?: string };
  }>("/authz/check", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const { userId, permission, orgUnitId } = req.query;
    if (!isNonEmptyString(userId)) {
      return badRequest(reply, "userId is required.");
    }
    if (!isNonEmptyString(permission)) {
      return badRequest(reply, "permission is required.");
    }
    if (!isNonEmptyString(orgUnitId)) {
      return badRequest(reply, "orgUnitId is required.");
    }
    const target = await deps.store.getAncestry(ctx, orgUnitId);
    if (!target) {
      return reply
        .code(404)
        .send({ error: "not_found", message: "Org unit not found." });
    }
    const grants = await deps.store.listGrants(ctx, userId);
    const decision = checkAccess(grants, permission, target);
    return reply.code(200).send({ decision });
  });

  app.get<{ Params: { id: string } }>(
    "/users/:id/effective-permissions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const grants = await deps.store.listGrants(ctx, req.params.id);
      return reply
        .code(200)
        .send({ permissions: effectivePermissions(grants) });
    },
  );
}
