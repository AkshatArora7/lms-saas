import {
  PURGE_TARGETS,
  type AuditEvent,
  type ContentArchiveItem,
  type OffboardingPorts,
  type OneRosterData,
  type PurgeResult,
} from "./offboarding.js";

export interface HttpOffboardingOptions {
  /** Base URL of the API gateway, e.g. http://gateway:4000. */
  gatewayUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Gateway-backed offboarding ports. The tenant service is the control plane, so
 * it acts on a target tenant by forwarding `x-tenant-id`; each service applies
 * its own RLS. The roster/content reads and per-service purge use the
 * conventional admin contract below — the endpoints other services expose for
 * data-subject export/erasure. Audit is appended via the audit service.
 *
 * NOTE: the per-service `DELETE /admin/tenant-data` + `GET /admin/export`
 * endpoints are the offboarding contract; services that have not yet
 * implemented them surface as `ok:false` in the purge report (a visible
 * remnant, never a silent success).
 */
export function createHttpOffboardingPorts(
  opts: HttpOffboardingOptions,
): OffboardingPorts {
  const base = opts.gatewayUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  function headers(tenantId: string, body = false): Record<string, string> {
    return {
      "x-tenant-id": tenantId,
      ...(body ? { "content-type": "application/json" } : {}),
    };
  }

  return {
    async exportRoster(tenantId): Promise<OneRosterData> {
      const res = await doFetch(`${base}/user-org/admin/export`, {
        headers: headers(tenantId),
      });
      if (!res.ok) {
        return { orgs: [], users: [], enrollments: [], academicSessions: [] };
      }
      const body = (await res.json()) as Partial<OneRosterData>;
      return {
        orgs: body.orgs ?? [],
        users: body.users ?? [],
        enrollments: body.enrollments ?? [],
        academicSessions: body.academicSessions ?? [],
      };
    },

    async exportContent(tenantId): Promise<ContentArchiveItem[]> {
      const res = await doFetch(`${base}/content/admin/export`, {
        headers: headers(tenantId),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { items?: ContentArchiveItem[] };
      return body.items ?? [];
    },

    async purge(tenantId, service): Promise<PurgeResult> {
      if (!PURGE_TARGETS.includes(service)) {
        return { service, ok: false, error: "unknown_service" };
      }
      try {
        const res = await doFetch(`${base}/${service}/admin/tenant-data`, {
          method: "DELETE",
          headers: headers(tenantId),
        });
        if (!res.ok) {
          return { service, ok: false, error: `status_${res.status}` };
        }
        const body = (await res.json().catch(() => ({}))) as { purged?: number };
        return {
          service,
          ok: true,
          ...(typeof body.purged === "number" ? { purged: body.purged } : {}),
        };
      } catch {
        return { service, ok: false, error: "unreachable" };
      }
    },

    async audit(tenantId, event: AuditEvent): Promise<void> {
      await doFetch(`${base}/audit/audit/events`, {
        method: "POST",
        headers: headers(tenantId, true),
        body: JSON.stringify({
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId,
          ...(event.actorId ? { actorId: event.actorId } : {}),
          ...(event.metadata ? { metadata: event.metadata } : {}),
        }),
      });
    },
  };
}
