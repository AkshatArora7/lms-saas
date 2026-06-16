import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyInstance, FastifyReply } from "fastify";

import {
  SUBSCRIPTION_STATUSES,
  seatCheck,
  type PlanStore,
  type SubscriptionStatus,
  type SubscriptionStore,
} from "./store.js";

export interface BillingRouteDeps {
  config: AppConfig;
  planStore: PlanStore;
  subscriptionStore: SubscriptionStore;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "invalid_request", message });
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: "not_found", message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

/** Register the billing surface: plan catalog + per-tenant subscription. */
export function registerBillingRoutes(
  app: FastifyInstance,
  deps: BillingRouteDeps,
): void {
  const ctxFor = (id: string): TenantContext => ({
    tenantId: id,
    tier: deps.config.DEFAULT_TENANT_TIER,
    databaseUrl: deps.config.DATABASE_URL,
  });

  app.get("/plans", async (_req, reply) => {
    const plans = await deps.planStore.listPlans();
    return reply.code(200).send({ plans });
  });

  app.post<{ Params: { id: string } }>(
    "/tenants/:id/subscription",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const body = (req.body ?? {}) as {
        planCode?: unknown;
        seats?: unknown;
        status?: unknown;
        periodStart?: unknown;
        periodEnd?: unknown;
      };
      if (!isNonEmptyString(body.planCode)) {
        return badRequest(reply, "planCode is required.");
      }
      if (
        body.seats !== undefined &&
        body.seats !== null &&
        (typeof body.seats !== "number" ||
          !Number.isInteger(body.seats) ||
          body.seats < 0)
      ) {
        return badRequest(reply, "seats must be a non-negative integer or null.");
      }
      if (body.status !== undefined && !isSubscriptionStatus(body.status)) {
        return badRequest(reply, "Invalid status.");
      }
      const result = await deps.subscriptionStore.subscribe(ctxFor(id), {
        planCode: body.planCode.trim(),
        ...(body.seats !== undefined ? { seats: body.seats as number | null } : {}),
        ...(isSubscriptionStatus(body.status) ? { status: body.status } : {}),
        ...(isNonEmptyString(body.periodStart)
          ? { periodStart: body.periodStart }
          : {}),
        ...(isNonEmptyString(body.periodEnd) ? { periodEnd: body.periodEnd } : {}),
      });
      if (!result.ok) {
        return badRequest(reply, "Unknown plan code.");
      }
      return reply.code(201).send({ subscription: result.subscription });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/tenants/:id/subscription",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const subscription = await deps.subscriptionStore.getCurrent(ctxFor(id));
      if (!subscription) return notFound(reply, "No subscription for this tenant.");
      return reply.code(200).send({ subscription });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/tenants/:id/subscription/transition",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const to = (req.body as { to?: unknown } | undefined)?.to;
      if (!isSubscriptionStatus(to)) {
        return badRequest(
          reply,
          `to must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}.`,
        );
      }
      const current = await deps.subscriptionStore.getCurrent(ctxFor(id));
      if (!current) return notFound(reply, "No subscription for this tenant.");
      const result = await deps.subscriptionStore.transition(
        ctxFor(id),
        current.id,
        to,
      );
      if (!result.ok) {
        if (result.reason === "not_found") {
          return notFound(reply, "No subscription for this tenant.");
        }
        return badRequest(
          reply,
          `Cannot transition from ${current.status} to ${to}.`,
        );
      }
      return reply.code(200).send({ subscription: result.subscription });
    },
  );

  app.put<{ Params: { id: string } }>(
    "/tenants/:id/subscription/seats",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const seats = (req.body as { seats?: unknown } | undefined)?.seats;
      if (
        seats !== null &&
        (typeof seats !== "number" || !Number.isInteger(seats) || seats < 0)
      ) {
        return badRequest(reply, "seats must be a non-negative integer or null.");
      }
      const current = await deps.subscriptionStore.getCurrent(ctxFor(id));
      if (!current) return notFound(reply, "No subscription for this tenant.");
      const result = await deps.subscriptionStore.setSeats(
        ctxFor(id),
        current.id,
        seats,
      );
      if (!result.ok) return notFound(reply, "No subscription for this tenant.");
      return reply.code(200).send({ subscription: result.subscription });
    },
  );

  // Seat enforcement: callers pass the current active-user count.
  app.get<{ Params: { id: string }; Querystring: { activeUsers?: string } }>(
    "/tenants/:id/subscription/seat-check",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const activeUsers = Number(req.query.activeUsers ?? "0");
      if (!Number.isFinite(activeUsers) || activeUsers < 0) {
        return badRequest(reply, "activeUsers must be a non-negative number.");
      }
      const current = await deps.subscriptionStore.getCurrent(ctxFor(id));
      return reply.code(200).send({ check: seatCheck(current, activeUsers) });
    },
  );
}
