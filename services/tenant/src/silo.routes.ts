import type { FastifyInstance, FastifyReply } from "fastify";

import {
  promoteToSilo,
  type SagaRun,
  type SagaStateStore,
} from "./silo.saga.js";
import type { SiloProvisioningPort } from "./silo.js";
import type { TenantStore } from "./store.js";

export interface SiloRouteDeps {
  store: TenantStore;
  /** Infra port (prod = Neon stub adapter; tests inject a fake). */
  port: SiloProvisioningPort;
  /** Durable saga-state store (control-plane). */
  sagaStore: SagaStateStore;
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

/** Public projection of a run row (never leaks raw DSN — database_ref is an opaque ref). */
function toMigrationView(run: SagaRun): Record<string, unknown> {
  return {
    id: run.id,
    tenantId: run.tenantId,
    status: run.status,
    completedSteps: run.completedSteps,
    target:
      run.databaseRef || run.projectId || run.branchId
        ? {
            projectId: run.projectId,
            branchId: run.branchId,
            databaseRef: run.databaseRef,
          }
        : null,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

interface PromoteBody {
  idempotencyKey?: unknown;
  actorId?: unknown;
  region?: unknown;
}

/**
 * Silo-promotion surface (issue #3) on the tenant control plane:
 * - POST /tenants/:id/promote-to-silo  — run the pool->silo saga (idempotent).
 * - GET  /tenants/:id/silo-migration   — read the latest run's status.
 *
 * AUTHZ: like every control-plane tenant route (see routes.ts:47-55), this
 * surface carries NO in-service `x-tenant-id` resolver and no per-tenant claim
 * — authorization for the control plane (and this destructive super-admin
 * action in particular) is an UPSTREAM concern (gateway / platform admin). The
 * security-agent reviews that gate; this route does not invent one.
 */
export function registerSiloRoutes(
  app: FastifyInstance,
  deps: SiloRouteDeps,
): void {
  app.post<{ Params: { id: string } }>(
    "/tenants/:id/promote-to-silo",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");

      const body = (req.body ?? {}) as PromoteBody;
      if (!isNonEmptyString(body.idempotencyKey)) {
        return badRequest(reply, "idempotencyKey is required.");
      }
      if (body.region !== undefined && typeof body.region !== "string") {
        return badRequest(reply, "region must be a string.");
      }

      const tenant = await deps.store.getTenant(id);
      if (!tenant) return notFound(reply, "Tenant not found.");

      // Idempotency replay: an existing run for this key is returned as-is and
      // never starts a second saga — even for an already-silo tenant. Keys share
      // one global namespace, so a run bound to a DIFFERENT tenant must NOT be
      // echoed here (it would leak that tenant's opaque control-plane refs);
      // reject the cross-tenant key reuse instead.
      const replay = await deps.sagaStore.getRunByKey(body.idempotencyKey.trim());
      if (replay) {
        if (replay.tenantId !== id) {
          return reply.code(409).send({
            error: "idempotency_key_conflict",
            message: "idempotency key already used for a different tenant",
          });
        }
        return reply.code(200).send({ migration: toMigrationView(replay) });
      }

      // Only a pool tenant can be promoted; a silo tenant is already migrated.
      if (tenant.tier !== "pool") {
        return reply.code(409).send({
          error: "already_silo",
          message: "Tenant is not pool-tier; nothing to promote.",
        });
      }

      const outcome = await promoteToSilo(
        {
          tenantId: id,
          idempotencyKey: body.idempotencyKey.trim(),
          region: isNonEmptyString(body.region) ? body.region.trim() : tenant.region,
        },
        { port: deps.port, store: deps.store, sagaStore: deps.sagaStore },
      );

      // Fake/synchronous adapter completes inline; the status endpoint + a 202
      // path are designed in for the long-running LIVE adapter (handshake §4).
      if (outcome.ok) {
        const updated = await deps.store.getTenant(id);
        return reply.code(200).send({
          migration: toMigrationView(outcome.run),
          tenant: updated ? { tenant: updated } : undefined,
        });
      }

      // Failure path: the saga rolled the catalog back to its prior pool state.
      return reply.code(409).send({
        migration: toMigrationView(outcome.run),
        failedStep: outcome.failedStep,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/tenants/:id/silo-migration",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const tenant = await deps.store.getTenant(id);
      if (!tenant) return notFound(reply, "Tenant not found.");

      const run = await deps.sagaStore.getLatestRunByTenant(id);
      if (!run) return notFound(reply, "No silo migration for this tenant.");
      return reply.code(200).send({ migration: toMigrationView(run) });
    },
  );
}
