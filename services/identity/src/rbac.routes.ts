import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { RbacStore } from "./rbac.js";

export interface RbacRouteDeps {
  store: RbacStore;
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: RbacRouteDeps,
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

function systemRoleForbidden(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({
    error: "system_role",
    message: "System roles are read-only.",
  });
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: "not_found", message: "Role not found." });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Register the RBAC management surface (roles + permission mappings). */
export function registerRbacRoutes(
  app: FastifyInstance,
  deps: RbacRouteDeps,
): void {
  app.get("/permissions", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const permissions = await deps.store.listPermissions(ctx);
    return reply.code(200).send({ permissions });
  });

  app.post("/roles", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as { name?: unknown };
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    const result = await deps.store.createRole(ctx, body.name.trim());
    if (!result.ok) {
      return reply.code(409).send({
        error: "name_taken",
        message: "A role with this name already exists.",
      });
    }
    return reply.code(201).send({ role: result.role });
  });

  app.get("/roles", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const roles = await deps.store.listRoles(ctx);
    return reply.code(200).send({ roles });
  });

  app.get<{ Params: { id: string } }>("/roles/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const role = await deps.store.getRole(ctx, req.params.id);
    if (!role) return notFound(reply);
    return reply.code(200).send({ role });
  });

  app.patch<{ Params: { id: string } }>("/roles/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as { name?: unknown };
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    const result = await deps.store.renameRole(ctx, req.params.id, body.name.trim());
    if (!result.ok) {
      if (result.reason === "not_found") return notFound(reply);
      if (result.reason === "system_role") return systemRoleForbidden(reply);
      return reply.code(409).send({
        error: "name_taken",
        message: "A role with this name already exists.",
      });
    }
    return reply.code(200).send({ role: result.role });
  });

  app.delete<{ Params: { id: string } }>("/roles/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const result = await deps.store.deleteRole(ctx, req.params.id);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound(reply);
      return systemRoleForbidden(reply);
    }
    return reply.code(204).send();
  });

  app.put<{ Params: { id: string } }>(
    "/roles/:id/permissions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { permissions?: unknown };
      if (
        !Array.isArray(body.permissions) ||
        !body.permissions.every((p) => isNonEmptyString(p))
      ) {
        return badRequest(reply, "permissions must be an array of strings.");
      }
      const result = await deps.store.setRolePermissions(
        ctx,
        req.params.id,
        body.permissions.map((p) => (p as string).trim()),
      );
      if (!result.ok) {
        if (result.reason === "not_found") return notFound(reply);
        if (result.reason === "system_role") return systemRoleForbidden(reply);
        return badRequest(reply, "One or more permission keys are unknown.");
      }
      return reply.code(200).send({ role: result.role });
    },
  );
}
