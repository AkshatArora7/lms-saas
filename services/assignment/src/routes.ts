import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  AssignmentStore,
  SubmissionType,
  UpdateAssignmentInput,
} from "./store.js";

export interface AssignmentRouteDeps {
  config: AppConfig;
  store: AssignmentStore;
  /** Resolve the tenant for a request (the gateway injects `x-tenant-id`). */
  resolveTenant: (req: FastifyRequest) => TenantContext;
}

function resolveTenantOr400(
  deps: AssignmentRouteDeps,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const SUBMISSION_TYPES: readonly SubmissionType[] = [
  "file",
  "text",
  "url",
  "none",
];

interface AssignmentBody {
  courseId?: unknown;
  title?: unknown;
  instructions?: unknown;
  dueAt?: unknown;
  points?: unknown;
  submissionType?: unknown;
  allowLate?: unknown;
}

interface SubmissionBody {
  userId?: unknown;
  body?: unknown;
  blobUrl?: unknown;
}

/** Validate the shared assignment fields on a create/update body. Returns an
 * error message, or null when every provided field is valid. */
function validateAssignmentFields(body: AssignmentBody): string | null {
  if (body.points !== undefined && !isFiniteNumber(body.points)) {
    return "points must be a number.";
  }
  if (
    body.submissionType !== undefined &&
    !SUBMISSION_TYPES.includes(body.submissionType as SubmissionType)
  ) {
    return `submissionType must be one of ${SUBMISSION_TYPES.join(", ")}.`;
  }
  if (body.dueAt !== undefined && body.dueAt !== null) {
    if (typeof body.dueAt !== "string" || Number.isNaN(Date.parse(body.dueAt))) {
      return "dueAt must be an ISO timestamp.";
    }
  }
  if (body.allowLate !== undefined && typeof body.allowLate !== "boolean") {
    return "allowLate must be a boolean.";
  }
  return null;
}

/** Register the assignment domain surface: assignment CRUD + submissions. */
export function registerAssignmentRoutes(
  app: FastifyInstance,
  deps: AssignmentRouteDeps,
): void {
  app.post("/assignments", async (req, reply) => {
    const ctx = resolveTenantOr400(deps, req, reply);
    if (!ctx) return reply;

    const body = (req.body ?? {}) as AssignmentBody;
    if (!isNonEmptyString(body.courseId)) {
      return badRequest(reply, "courseId is required.");
    }
    if (!isNonEmptyString(body.title)) {
      return badRequest(reply, "title is required.");
    }
    const fieldError = validateAssignmentFields(body);
    if (fieldError) {
      return badRequest(reply, fieldError);
    }

    const assignment = await deps.store.createAssignment(ctx, {
      courseId: body.courseId.trim(),
      title: body.title.trim(),
      instructions: isNonEmptyString(body.instructions)
        ? body.instructions.trim()
        : null,
      dueAt: (body.dueAt as string | null | undefined) ?? null,
      points: body.points as number | undefined,
      submissionType: body.submissionType as SubmissionType | undefined,
      allowLate: body.allowLate as boolean | undefined,
    });
    return reply.code(201).send({ assignment });
  });

  app.get<{ Params: { id: string } }>(
    "/assignments/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const assignment = await deps.store.getAssignment(ctx, req.params.id);
      if (!assignment) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Assignment not found." });
      }
      return reply.code(200).send({ assignment });
    },
  );

  app.get<{ Querystring: { courseId?: string } }>(
    "/assignments",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      if (!isNonEmptyString(req.query.courseId)) {
        return badRequest(reply, "courseId query parameter is required.");
      }
      const assignments = await deps.store.listAssignments(
        ctx,
        req.query.courseId.trim(),
      );
      return reply.code(200).send({ assignments });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/assignments/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;

      const body = (req.body ?? {}) as AssignmentBody;
      if (body.title !== undefined && !isNonEmptyString(body.title)) {
        return badRequest(reply, "title, when provided, must be non-empty.");
      }
      const fieldError = validateAssignmentFields(body);
      if (fieldError) {
        return badRequest(reply, fieldError);
      }

      const input: UpdateAssignmentInput = {};
      if (body.title !== undefined) input.title = (body.title as string).trim();
      if (body.instructions !== undefined) {
        input.instructions = isNonEmptyString(body.instructions)
          ? body.instructions.trim()
          : null;
      }
      if (body.dueAt !== undefined) {
        input.dueAt = (body.dueAt as string | null) ?? null;
      }
      if (body.points !== undefined) input.points = body.points as number;
      if (body.submissionType !== undefined) {
        input.submissionType = body.submissionType as SubmissionType;
      }
      if (body.allowLate !== undefined) {
        input.allowLate = body.allowLate as boolean;
      }

      const assignment = await deps.store.updateAssignment(
        ctx,
        req.params.id,
        input,
      );
      if (!assignment) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Assignment not found." });
      }
      return reply.code(200).send({ assignment });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/assignments/:id",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const deleted = await deps.store.deleteAssignment(ctx, req.params.id);
      if (!deleted) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Assignment not found." });
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/assignments/:id/submissions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const body = (req.body ?? {}) as SubmissionBody;
      if (!isNonEmptyString(body.userId)) {
        return badRequest(reply, "userId is required.");
      }

      const result = await deps.store.submit(ctx, req.params.id, {
        userId: body.userId.trim(),
        body: isNonEmptyString(body.body) ? body.body : null,
        blobUrl: isNonEmptyString(body.blobUrl) ? body.blobUrl.trim() : null,
      });
      if (!result.ok) {
        if (result.reason === "unknown_assignment") {
          return reply
            .code(404)
            .send({ error: "not_found", message: "Assignment not found." });
        }
        return reply.code(409).send({
          error: "late_not_allowed",
          message: "This assignment does not accept late submissions.",
        });
      }
      return reply
        .code(result.resubmitted ? 200 : 201)
        .send({ submission: result.submission });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/assignments/:id/submissions",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const submissions = await deps.store.listSubmissions(ctx, req.params.id);
      return reply.code(200).send({ submissions });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/submissions/:id/return",
    async (req, reply) => {
      const ctx = resolveTenantOr400(deps, req, reply);
      if (!ctx) return reply;
      const submission = await deps.store.returnSubmission(ctx, req.params.id);
      if (!submission) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Submission not found." });
      }
      return reply.code(200).send({ submission });
    },
  );
}
