import { withTenant } from "@lms/db";

import type {
  AnnouncementRecord,
  AnnouncementStore,
  NewAnnouncementInput,
  UpdateAnnouncementInput,
} from "./store.js";

interface AnnouncementRow {
  id: string;
  tenant_id: string;
  org_unit_id: string;
  author_id: string | null;
  title: string;
  body: string;
  publish_at: Date | string;
  expires_at: Date | string | null;
  created_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: AnnouncementRow): AnnouncementRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orgUnitId: row.org_unit_id,
    authorId: row.author_id,
    title: row.title,
    body: row.body,
    publishAt: iso(row.publish_at) ?? "",
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at) ?? "",
  };
}

const SELECT = `
  SELECT id, tenant_id, org_unit_id, author_id, title, body,
         publish_at, expires_at, created_at
    FROM announcement`;

/**
 * Postgres-backed announcement store. Every call runs through `withTenant`, so
 * all statements execute inside an RLS-scoped transaction (pool) or against the
 * tenant's silo database — rows can never leak across tenants.
 */
export function createPrismaStore(): AnnouncementStore {
  return {
    async create(ctx, input: NewAnnouncementInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AnnouncementRow[]>(
          `INSERT INTO announcement
             (tenant_id, org_unit_id, author_id, title, body, publish_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7::timestamptz)
           RETURNING id, tenant_id, org_unit_id, author_id, title, body,
                     publish_at, expires_at, created_at`,
          ctx.tenantId,
          input.orgUnitId,
          input.authorId ?? null,
          input.title,
          input.body,
          input.publishAt ?? null,
          input.expiresAt ?? null,
        );
        return toRecord(rows[0]!);
      });
    },

    async get(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AnnouncementRow[]>(
          `${SELECT} WHERE id = $1 LIMIT 1`,
          id,
        );
        return rows[0] ? toRecord(rows[0]) : null;
      });
    },

    async listForOrgUnit(ctx, orgUnitId, opts = {}) {
      return withTenant(ctx, async (db) => {
        const rows = opts.visibleOnly
          ? await db.$queryRawUnsafe<AnnouncementRow[]>(
              `${SELECT}
                WHERE org_unit_id = $1
                  AND publish_at <= now()
                  AND (expires_at IS NULL OR expires_at > now())
                ORDER BY publish_at DESC`,
              orgUnitId,
            )
          : await db.$queryRawUnsafe<AnnouncementRow[]>(
              `${SELECT} WHERE org_unit_id = $1 ORDER BY publish_at DESC`,
              orgUnitId,
            );
        return rows.map(toRecord);
      });
    },

    async update(ctx, id, input: UpdateAnnouncementInput) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AnnouncementRow[]>(
          `UPDATE announcement SET
             title = COALESCE($2, title),
             body = COALESCE($3, body),
             publish_at = COALESCE($4::timestamptz, publish_at),
             expires_at = CASE WHEN $5 THEN $6::timestamptz ELSE expires_at END
           WHERE id = $1
           RETURNING id, tenant_id, org_unit_id, author_id, title, body,
                     publish_at, expires_at, created_at`,
          id,
          input.title ?? null,
          input.body ?? null,
          input.publishAt ?? null,
          input.expiresAt !== undefined,
          input.expiresAt ?? null,
        );
        return rows[0] ? toRecord(rows[0]) : null;
      });
    },

    async publishNow(ctx, id) {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AnnouncementRow[]>(
          `UPDATE announcement SET publish_at = now()
            WHERE id = $1
            RETURNING id, tenant_id, org_unit_id, author_id, title, body,
                      publish_at, expires_at, created_at`,
          id,
        );
        return rows[0] ? toRecord(rows[0]) : null;
      });
    },

    async remove(ctx, id) {
      return withTenant(ctx, async (db) => {
        const deleted = await db.$executeRawUnsafe(
          `DELETE FROM announcement WHERE id = $1`,
          id,
        );
        return deleted > 0;
      });
    },
  };
}
