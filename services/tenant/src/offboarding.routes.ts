import type { FastifyInstance, FastifyReply } from "fastify";

import {
  PURGE_TARGETS,
  toOneRosterCsv,
  type OffboardingPorts,
  type PurgeResult,
} from "./offboarding.js";
import type { TenantStore } from "./store.js";

export interface OffboardingRouteDeps {
  store: TenantStore;
  ports: OffboardingPorts;
  /** Clock for export timestamps (injectable for deterministic tests). */
  now?: () => Date;
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

/**
 * Offboarding surface (issue #7) on the tenant control plane:
 * - GET  /tenants/:id/export   — OneRoster CSV + content archive (audited).
 * - POST /tenants/:id/offboard — purge fan-out across services (verified,
 *   audited), then mark the tenant deleted.
 */
export function registerOffboardingRoutes(
  app: FastifyInstance,
  deps: OffboardingRouteDeps,
): void {
  const now = deps.now ?? (() => new Date());

  app.get<{ Params: { id: string }; Querystring: { actorId?: string } }>(
    "/tenants/:id/export",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const tenant = await deps.store.getTenant(id);
      if (!tenant) return notFound(reply, "Tenant not found.");

      const [roster, content] = await Promise.all([
        deps.ports.exportRoster(id),
        deps.ports.exportContent(id),
      ]);
      const oneRoster = toOneRosterCsv(roster);
      const generatedAt = now().toISOString();

      await deps.ports.audit(id, {
        action: "tenant.data.exported",
        targetType: "tenant",
        targetId: id,
        ...(isNonEmptyString(req.query.actorId)
          ? { actorId: req.query.actorId }
          : {}),
        metadata: {
          users: roster.users.length,
          orgs: roster.orgs.length,
          enrollments: roster.enrollments.length,
          contentItems: content.length,
        },
      });

      return reply.code(200).send({
        tenantId: id,
        slug: tenant.slug,
        generatedAt,
        oneRoster,
        contentArchive: { items: content, count: content.length },
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/tenants/:id/offboard",
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return badRequest(reply, "tenant id must be a uuid.");
      const body = (req.body ?? {}) as { confirm?: unknown; actorId?: unknown };
      // Erasure is irreversible — require explicit confirmation.
      if (body.confirm !== true) {
        return badRequest(reply, "confirm must be true to offboard a tenant.");
      }
      const tenant = await deps.store.getTenant(id);
      if (!tenant) return notFound(reply, "Tenant not found.");

      // Fan the purge across every service, collecting a per-service verdict.
      const purge: PurgeResult[] = await Promise.all(
        PURGE_TARGETS.map((service) => deps.ports.purge(id, service)),
      );
      const allPurged = purge.every((p) => p.ok);
      const failed = purge.filter((p) => !p.ok).map((p) => p.service);

      await deps.ports.audit(id, {
        action: "tenant.data.purged",
        targetType: "tenant",
        targetId: id,
        ...(isNonEmptyString(body.actorId) ? { actorId: body.actorId } : {}),
        metadata: { services: purge.length, allPurged, failed },
      });

      // Only flip the registry to deleted once every service confirmed.
      const updated = allPurged ? await deps.store.setStatus(id, "deleted") : tenant;

      return reply.code(allPurged ? 200 : 207).send({
        tenantId: id,
        status: updated?.status ?? tenant.status,
        allPurged,
        purge,
        ...(failed.length > 0 ? { failed } : {}),
      });
    },
  );
}
