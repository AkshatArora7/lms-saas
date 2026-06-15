import type { AppConfig } from "@lms/config";
import type { FastifyInstance, FastifyReply } from "fastify";

import { isValidSlug, type TenantStore } from "./store.js";

export interface TenantRouteDeps {
  config: AppConfig;
  store: TenantStore;
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

interface ProvisionBody {
  slug?: unknown;
  name?: unknown;
  region?: unknown;
  plan?: unknown;
}

/**
 * Register the tenant CONTROL-PLANE surface: provision and read tenants.
 *
 * These routes intentionally have NO `x-tenant-id` resolver. This is the
 * control plane (the tenant registry), not a tenant-scoped domain service: a
 * caller provisioning a tenant has no tenant context yet, and the `tenant`
 * table is outside RLS. Authorization for this surface is an upstream concern
 * (gateway / platform admin), not per-tenant scoping.
 */
export function registerTenantRoutes(
  app: FastifyInstance,
  deps: TenantRouteDeps,
): void {
  app.post("/tenants", async (req, reply) => {
    const body = (req.body ?? {}) as ProvisionBody;

    if (!isNonEmptyString(body.slug)) {
      return badRequest(reply, "slug is required.");
    }
    if (!isValidSlug(body.slug)) {
      return badRequest(
        reply,
        "slug must be a lowercase DNS label (a-z, 0-9, hyphens).",
      );
    }
    if (!isNonEmptyString(body.name)) {
      return badRequest(reply, "name is required.");
    }
    if (body.region !== undefined && typeof body.region !== "string") {
      return badRequest(reply, "region must be a string.");
    }
    if (body.plan !== undefined && typeof body.plan !== "string") {
      return badRequest(reply, "plan must be a string.");
    }

    const result = await deps.store.provisionTenant({
      slug: body.slug.trim(),
      name: body.name.trim(),
      region: body.region?.trim(),
      plan: body.plan?.trim(),
    });

    if (!result.ok) {
      if (result.reason === "slug_taken") {
        return reply.code(409).send({
          error: "slug_taken",
          message: "A tenant with this slug already exists.",
        });
      }
      return reply.code(400).send({
        error: "unknown_plan",
        message: "Unknown plan code.",
      });
    }

    return reply.code(201).send({ tenant: result.tenant });
  });

  app.get<{ Params: { id: string } }>("/tenants/:id", async (req, reply) => {
    const tenant = await deps.store.getTenant(req.params.id);
    if (!tenant) {
      return reply
        .code(404)
        .send({ error: "not_found", message: "Tenant not found." });
    }
    return reply.code(200).send({ tenant });
  });

  app.get("/tenants", async (_req, reply) => {
    const tenants = await deps.store.listTenants();
    return reply.code(200).send({ tenants });
  });
}
