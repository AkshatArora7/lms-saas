import { withTenant } from "@lms/db";
import { EVENT_TYPES } from "@lms/events";

import {
  aggregateEvents,
  type AggregateDimension,
  type AnalyticsStore,
  type CaliperEventRecord,
  type DeidentifiedAggregate,
  type EventFilter,
  type NewCaliperEventInput,
  type NewXapiStatementInput,
  type XapiStatementRecord,
} from "./store.js";

interface CaliperRow {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  type: string;
  action: string;
  object_type: string;
  object_id: string;
  org_unit_id: string | null;
  event_time: Date | string;
  envelope: unknown;
}

interface XapiRow {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  verb: string;
  object_id: string;
  result: unknown;
  stored_at: Date | string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toCaliper(row: CaliperRow): CaliperEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    type: row.type,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    orgUnitId: row.org_unit_id,
    eventTime: asIso(row.event_time),
    envelope: asObject(row.envelope),
  };
}

function toXapi(row: XapiRow): XapiStatementRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    verb: row.verb,
    objectId: row.object_id,
    result:
      row.result && typeof row.result === "object"
        ? (row.result as Record<string, unknown>)
        : null,
    storedAt: asIso(row.stored_at),
  };
}

const CALIPER_SELECT = `
  SELECT id, tenant_id, actor_id, type, action, object_type, object_id,
         org_unit_id, event_time, envelope
    FROM caliper_event`;

/** RLS-scoped LRS store (uuid params cast; outbox written in the same tx). */
export function createPrismaStore(): AnalyticsStore {
  return {
    async recordCaliperEvent(
      ctx,
      input: NewCaliperEventInput,
    ): Promise<CaliperEventRecord> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<CaliperRow[]>(
          `INSERT INTO caliper_event
             (tenant_id, actor_id, type, action, object_type, object_id,
              org_unit_id, event_time, envelope)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid,
                   COALESCE($8::timestamptz, now()), $9::jsonb)
           RETURNING id, tenant_id, actor_id, type, action, object_type,
                     object_id, org_unit_id, event_time, envelope`,
          ctx.tenantId,
          input.actorId ?? null,
          input.type,
          input.action,
          input.objectType,
          input.objectId,
          input.orgUnitId ?? null,
          input.eventTime ?? null,
          JSON.stringify(input.envelope ?? {}),
        );
        const event = toCaliper(rows[0]!);
        // Transactional outbox: the relay forwards this to QStash exactly-once.
        await db.$executeRawUnsafe(
          `INSERT INTO event_outbox (tenant_id, type, actor_id, org_unit_id, payload)
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::jsonb)`,
          ctx.tenantId,
          EVENT_TYPES.LEARNING_EVENT_CAPTURED,
          event.actorId,
          event.orgUnitId,
          JSON.stringify({
            caliperEventId: event.id,
            type: event.type,
            action: event.action,
          }),
        );
        return event;
      });
    },

    async recordXapiStatement(
      ctx,
      input: NewXapiStatementInput,
    ): Promise<XapiStatementRecord> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<XapiRow[]>(
          `INSERT INTO xapi_statement (tenant_id, actor_id, verb, object_id, result)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
           RETURNING id, tenant_id, actor_id, verb, object_id, result, stored_at`,
          ctx.tenantId,
          input.actorId ?? null,
          input.verb,
          input.objectId,
          input.result ? JSON.stringify(input.result) : null,
        );
        return toXapi(rows[0]!);
      });
    },

    async listEvents(ctx, filter?: EventFilter): Promise<CaliperEventRecord[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<CaliperRow[]>(
          `${CALIPER_SELECT}
            WHERE ($1::text IS NULL OR type = $1)
              AND ($2::text IS NULL OR action = $2)
              AND ($3::timestamptz IS NULL OR event_time >= $3::timestamptz)
              AND ($4::timestamptz IS NULL OR event_time < $4::timestamptz)
            ORDER BY event_time DESC`,
          filter?.type ?? null,
          filter?.action ?? null,
          filter?.from ?? null,
          filter?.to ?? null,
        );
        return rows.map(toCaliper);
      });
    },

    async aggregate(
      ctx,
      dimension: AggregateDimension,
      filter?: EventFilter,
    ): Promise<DeidentifiedAggregate> {
      // Reuse listEvents then aggregate in-process: de-identified (no actor) and
      // identical to the memory path, so behaviour matches across stores.
      const events = await this.listEvents(ctx, filter);
      return aggregateEvents(events, dimension);
    },
  };
}
