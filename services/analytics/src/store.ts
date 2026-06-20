import type { TenantContext } from "@lms/types";

/**
 * Learning Record Store for the analytics service (issue #60). Captures
 * standardized learning events (Caliper) and xAPI statements into the
 * tenant-scoped LRS tables, writing a transactional outbox row alongside each
 * Caliper event so delivery to downstream/QStash is async and exactly-once.
 * De-identified aggregates (counts with no actor identity) are safe to combine
 * across tenants.
 */

export interface CaliperEventRecord {
  id: string;
  tenantId: string;
  actorId: string | null;
  type: string;
  action: string;
  objectType: string;
  objectId: string;
  orgUnitId: string | null;
  eventTime: string;
  envelope: Record<string, unknown>;
}

export interface NewCaliperEventInput {
  actorId?: string | null;
  type: string;
  action: string;
  objectType: string;
  objectId: string;
  orgUnitId?: string | null;
  eventTime?: string;
  envelope?: Record<string, unknown>;
}

export interface XapiStatementRecord {
  id: string;
  tenantId: string;
  actorId: string | null;
  verb: string;
  objectId: string;
  result: Record<string, unknown> | null;
  storedAt: string;
}

export interface NewXapiStatementInput {
  actorId?: string | null;
  verb: string;
  objectId: string;
  result?: Record<string, unknown> | null;
}

export interface EventFilter {
  type?: string;
  action?: string;
  from?: string;
  to?: string;
}

/** Dimensions a de-identified aggregate can group by. */
export type AggregateDimension = "type" | "action" | "objectType";
export const AGGREGATE_DIMENSIONS: readonly AggregateDimension[] = [
  "type",
  "action",
  "objectType",
];

export interface AggregateBucket {
  key: string;
  count: number;
}

/**
 * A de-identified aggregate: total event count and per-key counts for one
 * dimension. Carries NO actor identity, so it can be pooled cross-tenant.
 */
export interface DeidentifiedAggregate {
  dimension: AggregateDimension;
  total: number;
  buckets: AggregateBucket[];
}

/**
 * Pure aggregation over events, grouped by a dimension. Deterministic order
 * (count desc, then key asc) so output is stable for tests and dashboards.
 */
export function aggregateEvents(
  events: Pick<CaliperEventRecord, "type" | "action" | "objectType">[],
  dimension: AggregateDimension,
): DeidentifiedAggregate {
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = e[dimension];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets = [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { dimension, total: events.length, buckets };
}

/** Tenant-scoped LRS persistence (RLS via withTenant). */
export interface AnalyticsStore {
  /** Persist a Caliper event AND a transactional outbox row in one tx. */
  recordCaliperEvent(
    ctx: TenantContext,
    input: NewCaliperEventInput,
  ): Promise<CaliperEventRecord>;

  recordXapiStatement(
    ctx: TenantContext,
    input: NewXapiStatementInput,
  ): Promise<XapiStatementRecord>;

  listEvents(
    ctx: TenantContext,
    filter?: EventFilter,
  ): Promise<CaliperEventRecord[]>;

  aggregate(
    ctx: TenantContext,
    dimension: AggregateDimension,
    filter?: EventFilter,
  ): Promise<DeidentifiedAggregate>;
}
