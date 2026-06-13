import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { CourseStore, NewCourseInput } from "./store.js";

export interface CourseRouteDeps {
  config: AppConfig;
  store: CourseStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

interface CreateCourseBody {
  title?: unknown;
  description?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

function resolveTenantOr400(
  deps: CourseRouteDeps,
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

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

/** Register the course domain surface: list, create, get, publish. */
export function registerCourseRoutes(
  app: FastifyInstance,
  deps: CourseRouteDeps,
): void {
  app.get("/courses", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;
    const courses = await deps.store.listCourses(ctx);
    return reply.code(200).send({ courses });
  });

  app.post("/courses", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as CreateCourseBody;
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "title is required.",
      });
    }

    const input: NewCourseInput = {
      title: body.title.trim(),
      description: optionalString(body.description) ?? null,
      startDate: optionalString(body.startDate) ?? null,
      endDate: optionalString(body.endDate) ?? null,
    };
    const course = await deps.store.createCourse(ctx, input);
    return reply.code(201).send({ course });
  });

  app.get<{ Params: { id: string } }>(
    "/courses/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const course = await deps.store.getCourse(ctx, req.params.id);
      if (!course) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Course not found." });
      }
      return reply.code(200).send({ course });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/courses/:id/publish",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const course = await deps.store.publishCourse(ctx, req.params.id);
      if (!course) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Course not found." });
      }
      return reply.code(200).send({ course });
    },
  );
}
