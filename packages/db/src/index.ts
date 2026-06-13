import { PrismaClient } from "@prisma/client";

import type { TenantContext } from "@lms/types";

/**
 * Hybrid pool + silo tenant routing.
 *
 *  - pool  → one shared PrismaClient; every query runs inside a transaction
 *            that first sets `app.tenant_id`, which Postgres RLS policies use
 *            to scope rows (see /database/policies).
 *  - silo  → a dedicated PrismaClient per tenant database, cached by tenant.
 *
 * Connection strings for silo tenants are resolved from the control-plane
 * tenant registry and (in prod) a secret store — never hard-coded.
 */

const sharedPoolByUrl = new Map<string, PrismaClient>();

/**
 * Lazily construct (and cache) the shared pool client. Deferring construction
 * keeps merely importing this module side-effect free, so services that inject
 * their own data layer (or run under test) never instantiate a client with an
 * unset DATABASE_URL.
 */
function sharedPool(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  let client = sharedPoolByUrl.get(url);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url } } });
    sharedPoolByUrl.set(url, client);
  }
  return client;
}

const siloClients = new Map<string, PrismaClient>();

function siloClient(databaseUrl: string): PrismaClient {
  let client = siloClients.get(databaseUrl);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    siloClients.set(databaseUrl, client);
  }
  return client;
}

/**
 * Run `work` with a tenant-scoped Prisma client.
 * For pool tenants the RLS GUC is set within the same transaction so it can
 * never leak across requests on a reused serverless connection.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  work: (db: PrismaClient) => Promise<T>,
): Promise<T> {
  if (ctx.tier === "silo") {
    return work(siloClient(ctx.databaseUrl));
  }

  return sharedPool().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.tenant_id', $1, true)`,
      ctx.tenantId,
    );
    return work(tx as unknown as PrismaClient);
  });
}

/** Control-plane access (tenant registry, silo routing) — never tenant-scoped. */
export function controlPlane(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: process.env.CONTROL_PLANE_DATABASE_URL ?? process.env.DATABASE_URL },
    },
  });
}

export { PrismaClient };
export type { TenantContext };
