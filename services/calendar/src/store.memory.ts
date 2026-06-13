import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  BellScheduleRecord,
  CreateTimetableResult,
  NewBellScheduleInput,
  NewTimetableEntryInput,
  SchedulePeriodRecord,
  SchedulingStore,
  TimetableEntryRecord,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory SchedulingStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Conflict detection
 * mirrors the Prisma store so behaviour is identical in dev/test and prod.
 * Used by the test suite and `CALENDAR_STORE=memory`.
 */
export class MemorySchedulingStore implements SchedulingStore {
  private bellSchedules: BellScheduleRecord[] = [];
  private timetable: TimetableEntryRecord[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {}

  seedBellSchedule(schedule: BellScheduleRecord): void {
    this.bellSchedules.push(schedule);
  }

  seedTimetableEntry(entry: TimetableEntryRecord): void {
    this.timetable.push(entry);
  }

  async listBellSchedules(
    ctx: TenantContext,
    orgUnitId?: string,
  ): Promise<BellScheduleRecord[]> {
    return this.bellSchedules.filter(
      (s) =>
        s.tenantId === ctx.tenantId &&
        (orgUnitId === undefined || s.orgUnitId === orgUnitId),
    );
  }

  async getBellSchedule(
    ctx: TenantContext,
    id: string,
  ): Promise<BellScheduleRecord | null> {
    return (
      this.bellSchedules.find(
        (s) => s.id === id && s.tenantId === ctx.tenantId,
      ) ?? null
    );
  }

  async createBellSchedule(
    ctx: TenantContext,
    input: NewBellScheduleInput,
  ): Promise<BellScheduleRecord> {
    const bellScheduleId = this.generateId();
    const periods: SchedulePeriodRecord[] = input.periods.map((p, i) => ({
      id: this.generateId(),
      tenantId: ctx.tenantId,
      bellScheduleId,
      name: p.name,
      sortOrder: p.sortOrder ?? i,
      startTime: p.startTime,
      endTime: p.endTime,
      dayPattern: p.dayPattern ?? "daily",
    }));
    const schedule: BellScheduleRecord = {
      id: bellScheduleId,
      tenantId: ctx.tenantId,
      orgUnitId: input.orgUnitId,
      name: input.name,
      timezone: input.timezone ?? "UTC",
      isDefault: input.isDefault ?? false,
      periods,
    };
    this.bellSchedules.push(schedule);
    return schedule;
  }

  async createTimetableEntry(
    ctx: TenantContext,
    input: NewTimetableEntryInput,
  ): Promise<CreateTimetableResult> {
    const dayOfWeek = input.dayOfWeek ?? null;
    const tenantEntries = this.timetable.filter(
      (e) => e.tenantId === ctx.tenantId,
    );

    const samePeriodDay = tenantEntries.filter(
      (e) => e.periodId === input.periodId && e.dayOfWeek === dayOfWeek,
    );

    if (samePeriodDay.some((e) => e.orgUnitId === input.orgUnitId)) {
      return { ok: false, conflict: "slot" };
    }
    if (
      input.room != null &&
      samePeriodDay.some((e) => e.room != null && e.room === input.room)
    ) {
      return { ok: false, conflict: "room" };
    }
    if (
      input.instructorId != null &&
      samePeriodDay.some((e) => e.instructorId === input.instructorId)
    ) {
      return { ok: false, conflict: "instructor" };
    }

    const entry: TimetableEntryRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      orgUnitId: input.orgUnitId,
      periodId: input.periodId,
      academicSessionId: input.academicSessionId ?? null,
      instructorId: input.instructorId ?? null,
      room: input.room ?? null,
      dayOfWeek,
    };
    this.timetable.push(entry);
    return { ok: true, entry };
  }

  async listTimetableForInstructor(
    ctx: TenantContext,
    instructorId: string,
  ): Promise<TimetableEntryRecord[]> {
    return this.timetable.filter(
      (e) => e.tenantId === ctx.tenantId && e.instructorId === instructorId,
    );
  }

  async listTimetableForOrgUnit(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<TimetableEntryRecord[]> {
    return this.timetable.filter(
      (e) => e.tenantId === ctx.tenantId && e.orgUnitId === orgUnitId,
    );
  }
}

/** Build a MemorySchedulingStore pre-seeded with a demo bell schedule. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
): MemorySchedulingStore {
  const store = new MemorySchedulingStore(generateId);
  store.seedBellSchedule({
    id: "demo-bell-schedule",
    tenantId: DEMO_TENANT_ID,
    orgUnitId: "demo-school",
    name: "Standard Day",
    timezone: "America/Toronto",
    isDefault: true,
    periods: [
      {
        id: "demo-period-1",
        tenantId: DEMO_TENANT_ID,
        bellScheduleId: "demo-bell-schedule",
        name: "Period 1",
        sortOrder: 0,
        startTime: "08:30",
        endTime: "09:20",
        dayPattern: "daily",
      },
      {
        id: "demo-period-2",
        tenantId: DEMO_TENANT_ID,
        bellScheduleId: "demo-bell-schedule",
        name: "Period 2",
        sortOrder: 1,
        startTime: "09:25",
        endTime: "10:15",
        dayPattern: "daily",
      },
    ],
  });
  return store;
}
