import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ORG_UNIT_TYPES,
  type OrgUnitType,
  type UserOrgStore,
  type UserStatus,
} from "./store.js";

export interface UserOrgRouteDeps {
  config: AppConfig;
  store: UserOrgStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

const USER_STATUSES: readonly UserStatus[] = ["invited", "active", "inactive"];

function resolveTenantOr400(
  deps: UserOrgRouteDeps,
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

function isOrgUnitType(value: unknown): value is OrgUnitType {
  return (
    typeof value === "string" &&
    (ORG_UNIT_TYPES as readonly string[]).includes(value)
  );
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value.trim();
  return undefined;
}

interface OrgUnitBody {
  type?: unknown;
  parentId?: unknown;
  name?: unknown;
  code?: unknown;
}

interface UserBody {
  email?: unknown;
  displayName?: unknown;
  status?: unknown;
  locale?: unknown;
}

interface AssignRoleBody {
  role?: unknown;
  orgUnitId?: unknown;
  cascade?: unknown;
}

/** Register the user-org domain surface: org-unit tree + user/role management. */
export function registerUserOrgRoutes(
  app: FastifyInstance,
  deps: UserOrgRouteDeps,
): void {
  // --- Org-unit tree (story #22) -----------------------------------------
  app.post("/org-units", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as OrgUnitBody;
    if (!isOrgUnitType(body.type)) {
      return badRequest(
        reply,
        `type must be one of: ${ORG_UNIT_TYPES.join(", ")}.`,
      );
    }
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    const parentId = optionalString(body.parentId);
    const result = await deps.store.createOrgUnit(ctx, {
      type: body.type,
      parentId: parentId ?? null,
      name: body.name.trim(),
      code: optionalString(body.code) ?? null,
    });
    if (!result.ok) {
      return badRequest(reply, "Parent org unit not found for this tenant.");
    }
    return reply.code(201).send({ orgUnit: result.orgUnit });
  });

  app.get<{ Querystring: { parentId?: string; type?: string } }>(
    "/org-units",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const { parentId, type } = req.query;
      if (type !== undefined && !isOrgUnitType(type)) {
        return badRequest(reply, "Unknown org unit type filter.");
      }
      const orgUnits = await deps.store.listOrgUnits(ctx, {
        ...(parentId ? { parentId } : {}),
        ...(type ? { type } : {}),
      });
      return reply.code(200).send({ orgUnits });
    },
  );

  app.get<{ Params: { id: string } }>("/org-units/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const orgUnit = await deps.store.getOrgUnit(ctx, req.params.id);
    if (!orgUnit) return notFound(reply, "Org unit not found.");
    return reply.code(200).send({ orgUnit });
  });

  app.get<{ Params: { id: string } }>(
    "/org-units/:id/subtree",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const orgUnits = await deps.store.getSubtree(ctx, req.params.id);
      return reply.code(200).send({ orgUnits });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/org-units/:id/ancestors",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const orgUnits = await deps.store.getAncestors(ctx, req.params.id);
      return reply.code(200).send({ orgUnits });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/org-units/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as {
        name?: unknown;
        code?: unknown;
        isActive?: unknown;
      };
      const patch: {
        name?: string;
        code?: string | null;
        isActive?: boolean;
      } = {};
      if (body.name !== undefined) {
        if (!isNonEmptyString(body.name)) {
          return badRequest(reply, "name must be a non-empty string.");
        }
        patch.name = body.name.trim();
      }
      if (body.code !== undefined) patch.code = optionalString(body.code) ?? null;
      if (body.isActive !== undefined) {
        if (typeof body.isActive !== "boolean") {
          return badRequest(reply, "isActive must be a boolean.");
        }
        patch.isActive = body.isActive;
      }
      const orgUnit = await deps.store.updateOrgUnit(ctx, req.params.id, patch);
      if (!orgUnit) return notFound(reply, "Org unit not found.");
      return reply.code(200).send({ orgUnit });
    },
  );

  // --- Users & roles (story #23) -----------------------------------------
  app.post("/users", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as UserBody;
    if (!isNonEmptyString(body.email)) {
      return badRequest(reply, "email is required.");
    }
    if (!isNonEmptyString(body.displayName)) {
      return badRequest(reply, "displayName is required.");
    }
    if (body.status !== undefined && !isUserStatus(body.status)) {
      return badRequest(reply, "Invalid status.");
    }
    const result = await deps.store.createUser(ctx, {
      email: body.email.trim(),
      displayName: body.displayName.trim(),
      ...(isUserStatus(body.status) ? { status: body.status } : {}),
      ...(isNonEmptyString(body.locale) ? { locale: body.locale.trim() } : {}),
    });
    if (!result.ok) {
      return reply.code(409).send({
        error: "email_taken",
        message: "A user with this email already exists in this tenant.",
      });
    }
    return reply.code(201).send({ user: result.user });
  });

  app.get<{ Querystring: { status?: string; orgUnitId?: string } }>(
    "/users",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const { status, orgUnitId } = req.query;
      if (status !== undefined && !isUserStatus(status)) {
        return badRequest(reply, "Invalid status filter.");
      }
      const users = await deps.store.listUsers(ctx, {
        ...(status && isUserStatus(status) ? { status } : {}),
        ...(orgUnitId ? { orgUnitId } : {}),
      });
      return reply.code(200).send({ users });
    },
  );

  app.get<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const user = await deps.store.getUser(ctx, req.params.id);
    if (!user) return notFound(reply, "User not found.");
    return reply.code(200).send({ user });
  });

  app.patch<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const body = (req.body ?? {}) as UserBody;
    const patch: { displayName?: string; status?: UserStatus; locale?: string } =
      {};
    if (body.displayName !== undefined) {
      if (!isNonEmptyString(body.displayName)) {
        return badRequest(reply, "displayName must be a non-empty string.");
      }
      patch.displayName = body.displayName.trim();
    }
    if (body.status !== undefined) {
      if (!isUserStatus(body.status)) {
        return badRequest(reply, "Invalid status.");
      }
      patch.status = body.status;
    }
    if (body.locale !== undefined) {
      if (!isNonEmptyString(body.locale)) {
        return badRequest(reply, "locale must be a non-empty string.");
      }
      patch.locale = body.locale.trim();
    }
    const user = await deps.store.updateUser(ctx, req.params.id, patch);
    if (!user) return notFound(reply, "User not found.");
    return reply.code(200).send({ user });
  });

  app.post<{ Params: { id: string } }>(
    "/users/:id/roles",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as AssignRoleBody;
      if (!isNonEmptyString(body.role)) {
        return badRequest(reply, "role is required.");
      }
      if (!isNonEmptyString(body.orgUnitId)) {
        return badRequest(reply, "orgUnitId is required.");
      }
      const result = await deps.store.assignRole(ctx, req.params.id, {
        role: body.role.trim(),
        orgUnitId: body.orgUnitId.trim(),
        ...(typeof body.cascade === "boolean" ? { cascade: body.cascade } : {}),
      });
      if (!result.ok) {
        if (result.reason === "user_not_found") {
          return notFound(reply, "User not found.");
        }
        if (result.reason === "unknown_org_unit") {
          return badRequest(reply, "Org unit not found for this tenant.");
        }
        return badRequest(reply, "Unknown role for this tenant.");
      }
      return reply.code(201).send({ membership: result.membership });
    },
  );

  app.delete<{ Params: { id: string; assignmentId: string } }>(
    "/users/:id/roles/:assignmentId",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const removed = await deps.store.revokeRole(
        ctx,
        req.params.id,
        req.params.assignmentId,
      );
      if (!removed) return notFound(reply, "Role assignment not found.");
      return reply.code(204).send();
    },
  );
}

function isUserStatus(value: unknown): value is UserStatus {
  return (
    typeof value === "string" &&
    (USER_STATUSES as readonly string[]).includes(value)
  );
}
