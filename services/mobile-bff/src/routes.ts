import type { AppConfig } from "@lms/config";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "./auth.js";
import {
  UpstreamError,
  type DeviceInput,
  type DevicePlatform,
  type UpstreamClient,
} from "./upstream.js";

export interface MobileRouteDeps {
  config: AppConfig;
  upstream: UpstreamClient;
}

const PLATFORMS: readonly DevicePlatform[] = ["ios", "android", "web"];

function isPlatform(value: unknown): value is DevicePlatform {
  return (
    typeof value === "string" && (PLATFORMS as readonly string[]).includes(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

/** Map an upstream failure onto a client-facing status. */
function fromUpstream(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof UpstreamError) {
    // Surface auth/permission verbatim; collapse everything else to 502.
    if (err.status === 401 || err.status === 403 || err.status === 404) {
      return reply
        .code(err.status)
        .send({ error: "upstream_error", message: err.message });
    }
  }
  return reply
    .code(502)
    .send({ error: "bad_gateway", message: "An upstream service failed." });
}

/**
 * Mobile learner core flows (issue #79). Each route is a screen-shaped
 * aggregate: it authenticates with the shared token model, fans out to upstream
 * services in parallel, and returns exactly what one screen needs.
 */
export function registerMobileRoutes(
  app: FastifyInstance,
  deps: MobileRouteDeps,
): void {
  const { upstream, config } = deps;

  // Home screen: courses + what's due soon + unread badge, in one round-trip.
  app.get("/mobile/home", async (req, reply) => {
    const authed = await authenticate(req, reply, config);
    if (!authed) return reply;
    try {
      const [courses, dueSoon, unreadCount] = await Promise.all([
        upstream.listEnrolledCourses(authed.ctx),
        upstream.listDueSoon(authed.ctx),
        upstream.unreadCount(authed.ctx),
      ]);
      return reply.code(200).send({
        user: { id: authed.claims.sub, roles: authed.claims.roles },
        courses,
        dueSoon,
        unreadCount,
      });
    } catch (err) {
      return fromUpstream(reply, err);
    }
  });

  // Course detail screen: the course plus its assignments.
  app.get<{ Params: { courseId: string } }>(
    "/mobile/courses/:courseId",
    async (req, reply) => {
      const authed = await authenticate(req, reply, config);
      if (!authed) return reply;
      try {
        const course = await upstream.getCourse(authed.ctx, req.params.courseId);
        if (!course) {
          return reply
            .code(404)
            .send({ error: "not_found", message: "Course not found." });
        }
        const assignments = await upstream.listCourseAssignments(
          authed.ctx,
          req.params.courseId,
        );
        return reply.code(200).send({ course, assignments });
      } catch (err) {
        return fromUpstream(reply, err);
      }
    },
  );

  // Notifications screen.
  app.get("/mobile/notifications", async (req, reply) => {
    const authed = await authenticate(req, reply, config);
    if (!authed) return reply;
    try {
      const notifications = await upstream.listNotifications(authed.ctx);
      return reply.code(200).send({
        notifications,
        unreadCount: notifications.filter((n) => n.readAt === null).length,
      });
    } catch (err) {
      return fromUpstream(reply, err);
    }
  });

  // Submit work from mobile (forwards to the assignment service).
  app.post<{ Params: { assignmentId: string } }>(
    "/mobile/assignments/:assignmentId/submissions",
    async (req, reply) => {
      const authed = await authenticate(req, reply, config);
      if (!authed) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isNonEmptyString(body.content) && !Array.isArray(body.attachments)) {
        return badRequest(
          reply,
          "A submission needs content or attachments.",
        );
      }
      try {
        const submission = await upstream.submitAssignment(
          authed.ctx,
          req.params.assignmentId,
          body,
        );
        return reply.code(201).send({ submission });
      } catch (err) {
        return fromUpstream(reply, err);
      }
    },
  );

  // Register a device for push notifications (delivery owned by notification svc).
  app.post("/mobile/devices", async (req, reply) => {
    const authed = await authenticate(req, reply, config);
    if (!authed) return reply;
    const body = (req.body ?? {}) as { platform?: unknown; pushToken?: unknown };
    if (!isPlatform(body.platform)) {
      return badRequest(reply, "platform must be one of: ios, android, web.");
    }
    if (!isNonEmptyString(body.pushToken)) {
      return badRequest(reply, "pushToken is required.");
    }
    const input: DeviceInput = {
      platform: body.platform,
      pushToken: body.pushToken.trim(),
    };
    try {
      const device = await upstream.registerDevice(authed.ctx, input);
      return reply.code(201).send({ device });
    } catch (err) {
      return fromUpstream(reply, err);
    }
  });
}
