import type { FastifyInstance, FastifyReply } from "fastify";

import {
  tenantAccessDecision,
  type DelegationStore,
} from "./delegation.js";
import type { TenantStore } from "./store.js";

export interface DelegationRouteDeps {
  store: DelegationStore;
  /** Tenant registry, to 404 unknown tenants. */
  tenantStore: TenantStore;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: "not_found", message });
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Sub-tenant admin delegation surface (issue #5) on the tenant control plane.
 * `:id` is the scope (sub-tenant) being administered.
 */
export function registerDelegationRoutes(
  app: FastifyInstance,
  deps: DelegationRouteDeps,
): void {
  // District delegates admin of sub-tenant :id to a user.
  app.post<{ Params: { id: string } }>(
    "/tenants/:id/delegations",
    async (req, reply) => {
      const scopeTenantId = req.params.id;
      if (!isUuid(scopeTenantId)) {
        return badRequest(reply, "tenant id must be a uuid.");
      }
      const body = (req.body ?? {}) as {
        delegatorTenantId?: unknown;
        delegateUserId?: unknown;
        role?: unknown;
      };
      if (!isUuid(body.delegatorTenantId)) {
        return badRequest(reply, "delegatorTenantId must be a uuid.");
      }
      if (!isUuid(body.delegateUserId)) {
        return badRequest(reply, "delegateUserId must be a uuid.");
      }
      const result = await deps.store.createDelegation({
        delegatorTenantId: body.delegatorTenantId,
        scopeTenantId,
        delegateUserId: body.delegateUserId,
        ...(typeof body.role === "string" && body.role.trim()
          ? { role: body.role.trim() }
          : {}),
      });
      if (!result.ok) {
        if (result.reason === "unknown_tenant") {
          return notFound(reply, "Delegator or scope tenant not found.");
        }
        return badRequest(
          reply,
          "Scope tenant must be a sub-tenant (descendant) of the delegator.",
        );
      }
      return reply.code(201).send({ delegation: result.delegation });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/tenants/:id/delegations",
    async (req, reply) => {
      if (!isUuid(req.params.id)) {
        return badRequest(reply, "tenant id must be a uuid.");
      }
      const delegations = await deps.store.listDelegations(req.params.id);
      return reply.code(200).send({ delegations });
    },
  );

  app.post<{ Params: { id: string; did: string } }>(
    "/tenants/:id/delegations/:did/revoke",
    async (req, reply) => {
      if (!isUuid(req.params.did)) {
        return badRequest(reply, "delegation id must be a uuid.");
      }
      const revoked = await deps.store.revokeDelegation(req.params.did);
      if (!revoked) return notFound(reply, "Delegation not found.");
      return reply.code(200).send({ delegation: revoked });
    },
  );

  // Enforcement point: may actor (tenant+user) administer sub-tenant :id?
  app.get<{
    Params: { id: string };
    Querystring: { actorTenantId?: string; actorUserId?: string };
  }>("/tenants/:id/access-check", async (req, reply) => {
    const targetTenantId = req.params.id;
    if (!isUuid(targetTenantId)) {
      return badRequest(reply, "tenant id must be a uuid.");
    }
    const { actorTenantId, actorUserId } = req.query;
    if (!isUuid(actorTenantId)) {
      return badRequest(reply, "actorTenantId query param must be a uuid.");
    }
    if (!isUuid(actorUserId)) {
      return badRequest(reply, "actorUserId query param must be a uuid.");
    }
    const [targetIsDescendant, hasDelegation] = await Promise.all([
      deps.store.isDescendant(targetTenantId, actorTenantId),
      deps.store.hasActiveDelegation(targetTenantId, actorUserId),
    ]);
    const decision = tenantAccessDecision({
      actor: { tenantId: actorTenantId, userId: actorUserId },
      targetTenantId,
      targetIsDescendant,
      hasDelegation,
    });
    return reply.code(200).send({ decision });
  });
}
