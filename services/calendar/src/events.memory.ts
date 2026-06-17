import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  CalendarEventRecord,
  CalendarEventStore,
  EventFilter,
  NewEventInput,
  SyncSourceInput,
} from "./events.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory calendar event store. Rows are filtered by tenant id to emulate
 * the RLS isolation Postgres enforces. Used by the test suite and
 * `CALENDAR_STORE=memory`.
 */
export class MemoryCalendarEventStore implements CalendarEventStore {
  private events: CalendarEventRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createEvent(
    ctx: TenantContext,
    input: NewEventInput,
  ): Promise<CalendarEventRecord> {
    const event: CalendarEventRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      orgUnitId: input.orgUnitId ?? null,
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay ?? false,
      sourceType: "manual",
      sourceId: null,
      createdAt: this.now().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async syncSourceEvent(
    ctx: TenantContext,
    input: SyncSourceInput,
  ): Promise<CalendarEventRecord> {
    const existing = this.events.find(
      (e) =>
        e.tenantId === ctx.tenantId &&
        e.sourceType === input.sourceType &&
        e.sourceId === input.sourceId,
    );
    if (existing) {
      existing.orgUnitId = input.orgUnitId ?? null;
      existing.title = input.title;
      existing.description = input.description ?? null;
      existing.startsAt = input.startsAt;
      existing.endsAt = input.endsAt ?? null;
      existing.allDay = input.allDay ?? false;
      return existing;
    }
    const event: CalendarEventRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      orgUnitId: input.orgUnitId ?? null,
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay ?? false,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdAt: this.now().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async listEvents(
    ctx: TenantContext,
    filter: EventFilter = {},
  ): Promise<CalendarEventRecord[]> {
    return this.events
      .filter((e) => {
        if (e.tenantId !== ctx.tenantId) return false;
        if (filter.orgUnitId !== undefined && e.orgUnitId !== filter.orgUnitId) {
          return false;
        }
        if (filter.from !== undefined && e.startsAt < filter.from) return false;
        if (filter.to !== undefined && e.startsAt > filter.to) return false;
        return true;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async getEvent(
    ctx: TenantContext,
    id: string,
  ): Promise<CalendarEventRecord | null> {
    return (
      this.events.find((e) => e.id === id && e.tenantId === ctx.tenantId) ?? null
    );
  }

  async deleteEvent(ctx: TenantContext, id: string): Promise<boolean> {
    const before = this.events.length;
    this.events = this.events.filter(
      (e) => !(e.id === id && e.tenantId === ctx.tenantId),
    );
    return this.events.length < before;
  }
}
