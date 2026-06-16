import type { TenantContext } from "@lms/types";

export type EventSource = "assignment" | "quiz" | "manual";

export const EVENT_SOURCES: readonly EventSource[] = [
  "assignment",
  "quiz",
  "manual",
];

/** A calendar event (manual, or sourced from an assignment/quiz due date). */
export interface CalendarEventRecord {
  id: string;
  tenantId: string;
  orgUnitId: string | null;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  sourceType: EventSource;
  sourceId: string | null;
  createdAt: string;
}

export interface NewEventInput {
  orgUnitId?: string | null;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
}

/** Upsert payload for a due-date event owned by another service. */
export interface SyncSourceInput {
  sourceType: "assignment" | "quiz";
  sourceId: string;
  orgUnitId?: string | null;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
}

export interface EventFilter {
  orgUnitId?: string;
  /** ISO lower bound (inclusive) on starts_at. */
  from?: string;
  /** ISO upper bound (inclusive) on starts_at. */
  to?: string;
}

/**
 * Persistence boundary for calendar events. Separate from the scheduling store
 * so the timetable code is untouched; both run RLS-scoped via withTenant.
 */
export interface CalendarEventStore {
  /** Create a manual event. */
  createEvent(
    ctx: TenantContext,
    input: NewEventInput,
  ): Promise<CalendarEventRecord>;

  /**
   * Idempotently upsert a source-owned event by (source_type, source_id), so
   * assignment/quiz due dates aggregate into the unified calendar exactly once.
   */
  syncSourceEvent(
    ctx: TenantContext,
    input: SyncSourceInput,
  ): Promise<CalendarEventRecord>;

  listEvents(
    ctx: TenantContext,
    filter?: EventFilter,
  ): Promise<CalendarEventRecord[]>;

  getEvent(
    ctx: TenantContext,
    id: string,
  ): Promise<CalendarEventRecord | null>;

  deleteEvent(ctx: TenantContext, id: string): Promise<boolean>;
}
