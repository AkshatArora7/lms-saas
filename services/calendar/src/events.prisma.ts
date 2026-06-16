import { withTenant } from "@lms/db";

import type {
  CalendarEventRecord,
  CalendarEventStore,
  EventFilter,
  EventSource,
  NewEventInput,
  SyncSourceInput,
} from "./events.js";

interface EventRow {
  id: string;
  tenant_id: string;
  org_unit_id: string | null;
  title: string;
  description: string | null;
  starts_at: Date | string;
  ends_at: Date | string | null;
  all_day: boolean;
  source_type: EventSource;
  source_id: string | null;
  created_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
function isoOrNull(v: Date | string | null): string | null {
  return v === null ? null : iso(v);
}

function toEvent(r: EventRow): CalendarEventRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    orgUnitId: r.org_unit_id,
    title: r.title,
    description: r.description,
    startsAt: iso(r.starts_at),
    endsAt: isoOrNull(r.ends_at),
    allDay: r.all_day,
    sourceType: r.source_type,
    sourceId: r.source_id,
    createdAt: iso(r.created_at),
  };
}

const COLS = `id, tenant_id, org_unit_id, title, description, starts_at, ends_at,
  all_day, source_type, source_id, created_at`;

/**
 * Postgres-backed calendar event store. RLS-scoped via withTenant; uuid params
 * cast ::uuid. Source events (assignment/quiz due dates) upsert by
 * (source_type, source_id) so they aggregate exactly once.
 */
export function createPrismaEventStore(): CalendarEventStore {
  return {
    async createEvent(ctx, input: NewEventInput) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<EventRow[]>(
          `INSERT INTO calendar_event
             (tenant_id, org_unit_id, title, description, starts_at, ends_at,
              all_day, source_type, source_id)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz,
                   $7, 'manual', NULL)
           RETURNING ${COLS}`,
          ctx.tenantId,
          input.orgUnitId ?? null,
          input.title,
          input.description ?? null,
          input.startsAt,
          input.endsAt ?? null,
          input.allDay ?? false,
        );
        return toEvent(rows[0]!);
      });
    },

    async syncSourceEvent(ctx, input: SyncSourceInput) {
      return withTenant(ctx, async (db: Db) => {
        const existing = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM calendar_event
            WHERE source_type = $1 AND source_id = $2::uuid LIMIT 1`,
          input.sourceType,
          input.sourceId,
        );
        if (existing.length > 0) {
          const rows = await db.$queryRawUnsafe<EventRow[]>(
            `UPDATE calendar_event
                SET org_unit_id = $2::uuid, title = $3, description = $4,
                    starts_at = $5::timestamptz, ends_at = $6::timestamptz,
                    all_day = $7
              WHERE id = $1::uuid
              RETURNING ${COLS}`,
            existing[0]!.id,
            input.orgUnitId ?? null,
            input.title,
            input.description ?? null,
            input.startsAt,
            input.endsAt ?? null,
            input.allDay ?? false,
          );
          return toEvent(rows[0]!);
        }
        const rows = await db.$queryRawUnsafe<EventRow[]>(
          `INSERT INTO calendar_event
             (tenant_id, org_unit_id, title, description, starts_at, ends_at,
              all_day, source_type, source_id)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz,
                   $7, $8, $9::uuid)
           RETURNING ${COLS}`,
          ctx.tenantId,
          input.orgUnitId ?? null,
          input.title,
          input.description ?? null,
          input.startsAt,
          input.endsAt ?? null,
          input.allDay ?? false,
          input.sourceType,
          input.sourceId,
        );
        return toEvent(rows[0]!);
      });
    },

    async listEvents(ctx, filter: EventFilter = {}) {
      return withTenant(ctx, async (db: Db) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filter.orgUnitId) {
          params.push(filter.orgUnitId);
          conditions.push(`org_unit_id = $${params.length}::uuid`);
        }
        if (filter.from) {
          params.push(filter.from);
          conditions.push(`starts_at >= $${params.length}::timestamptz`);
        }
        if (filter.to) {
          params.push(filter.to);
          conditions.push(`starts_at <= $${params.length}::timestamptz`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = await db.$queryRawUnsafe<EventRow[]>(
          `SELECT ${COLS} FROM calendar_event ${where} ORDER BY starts_at`,
          ...params,
        );
        return rows.map(toEvent);
      });
    },

    async getEvent(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<EventRow[]>(
          `SELECT ${COLS} FROM calendar_event WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        return rows[0] ? toEvent(rows[0]) : null;
      });
    },

    async deleteEvent(ctx, id) {
      return withTenant(ctx, async (db: Db) => {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM calendar_event WHERE id = $1::uuid`,
          id,
        );
        return n > 0;
      });
    },
  };
}
