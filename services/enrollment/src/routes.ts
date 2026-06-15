import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { EnrollmentStore } from "./store.js";

export interface EnrollmentRouteDeps {
  config: AppConfig;
  store: EnrollmentStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: EnrollmentRouteDeps,
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

interface EnrollBody {
  userId?: unknown;
  orgUnitId?: unknown;
  role?: unknown;
}

/** Register the enrollment domain surface: enroll, drop, complete, roster. */
export function registerEnrollmentRoutes(
  app: FastifyInstance,
  deps: EnrollmentRouteDeps,
): void {
  app.post("/enrollments", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as EnrollBody;
    if (!isNonEmptyString(body.userId)) {
      return badRequest(reply, "userId is required.");
    }
    if (!isNonEmptyString(body.orgUnitId)) {
      return badRequest(reply, "orgUnitId is required.");
    }
    if (!isNonEmptyString(body.role)) {
      return badRequest(reply, "role is required.");
    }

    const result = await deps.store.createEnrollment(ctx, {
      userId: body.userId.trim(),
      orgUnitId: body.orgUnitId.trim(),
      role: body.role.trim(),
    });
    if (!result.ok) {
      if (result.reason === "unknown_role") {
        return badRequest(reply, "Unknown role for this tenant.");
      }
      return reply.code(409).send({
        error: "already_enrolled",
        message: "User is already enrolled in this section.",
      });
    }
    return reply.code(201).send({ enrollment: result.enrollment });
  });

  app.get<{ Params: { id: string } }>(
    "/enrollments/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const enrollment = await deps.store.getEnrollment(ctx, req.params.id);
      if (!enrollment) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Enrollment not found." });
      }
      return reply.code(200).send({ enrollment });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/enrollments/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const enrollment = await deps.store.dropEnrollment(ctx, req.params.id);
      if (!enrollment) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Enrollment not found." });
      }
      return reply.code(200).send({ enrollment });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/enrollments/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as { role?: unknown };
      if (!isNonEmptyString(body.role)) {
        return badRequest(reply, "role is required.");
      }
      const result = await deps.store.updateEnrollmentRole(
        ctx,
        req.params.id,
        body.role.trim(),
      );
      if (!result.ok) {
        if (result.reason === "unknown_role") {
          return badRequest(reply, "Unknown role for this tenant.");
        }
        return reply
          .code(404)
          .send({ error: "not_found", message: "Enrollment not found." });
      }
      return reply.code(200).send({ enrollment: result.enrollment });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/enrollments/:id/complete",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const enrollment = await deps.store.completeEnrollment(
        ctx,
        req.params.id,
      );
      if (!enrollment) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Enrollment not found." });
      }
      return reply.code(200).send({ enrollment });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/sections/:id/roster",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const roster = await deps.store.getRoster(ctx, req.params.id);
      return reply.code(200).send({ roster });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/users/:id/enrollments",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const enrollments = await deps.store.listForUser(ctx, req.params.id);
      return reply.code(200).send({ enrollments });
    },
  );
}
