import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { GroupStore } from "./groups.js";

export interface GroupRouteDeps {
  store: GroupStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: GroupRouteDeps,
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
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Register the group-assignment surface: group sets + membership. */
export function registerGroupRoutes(
  app: FastifyInstance,
  deps: GroupRouteDeps,
): void {
  app.post<{ Params: { assignmentId: string } }>(
    "/assignments/:assignmentId/groups",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { name?: unknown };
      if (!isNonEmptyString(body.name)) {
        return badRequest(reply, "name is required.");
      }
      const result = await deps.store.createGroup(
        ctx,
        req.params.assignmentId,
        body.name.trim(),
      );
      if (!result.ok) return notFound(reply, "Assignment not found.");
      return reply.code(201).send({ group: result.group });
    },
  );

  app.get<{ Params: { assignmentId: string } }>(
    "/assignments/:assignmentId/groups",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const groups = await deps.store.listGroups(ctx, req.params.assignmentId);
      return reply.code(200).send({ groups });
    },
  );

  app.get<{ Params: { id: string } }>("/groups/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const group = await deps.store.getGroup(ctx, req.params.id);
    if (!group) return notFound(reply, "Group not found.");
    return reply.code(200).send({ group });
  });

  app.delete<{ Params: { id: string } }>("/groups/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const removed = await deps.store.deleteGroup(ctx, req.params.id);
    if (!removed) return notFound(reply, "Group not found.");
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/groups/:id/members",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { userId?: unknown };
      if (!isNonEmptyString(body.userId)) {
        return badRequest(reply, "userId is required.");
      }
      const result = await deps.store.addMember(ctx, req.params.id, body.userId.trim());
      if (!result.ok) {
        if (result.reason === "group_not_found") return notFound(reply, "Group not found.");
        return reply.code(409).send({
          error: "already_in_a_group",
          message: "User is already in a group for this assignment.",
        });
      }
      return reply.code(200).send({ members: result.members });
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/groups/:id/members/:userId",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const removed = await deps.store.removeMember(
        ctx,
        req.params.id,
        req.params.userId,
      );
      if (!removed) return notFound(reply, "Member not found.");
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { assignmentId: string; userId: string } }>(
    "/assignments/:assignmentId/groups/for-user/:userId",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const group = await deps.store.groupForUser(
        ctx,
        req.params.assignmentId,
        req.params.userId,
      );
      if (!group) return notFound(reply, "User is not in a group for this assignment.");
      return reply.code(200).send({ group });
    },
  );
}
