import { TENANT_ID } from "./auth";

/**
 * Server-only client for the calendar / timetable microservice.
 *
 * BFF read boundary for an org unit's weekly timetable. The timetable entries
 * reference a `periodId`; the bell schedules carry the period start/end times,
 * so the schedule screen composes the two. Forwards the authenticated tenant as
 * `x-tenant-id`; reads return `[]` on failure for a clean empty/offline state.
 */

export const CALENDAR_SERVICE_URL =
  process.env.CALENDAR_SERVICE_URL ?? "http://localhost:4013";

export interface SchedulePeriod {
  id: string;
  tenantId: string;
  bellScheduleId: string;
  name: string;
  sortOrder: number;
  startTime: string;
  endTime: string;
  dayPattern: string;
}

export interface BellSchedule {
  id: string;
  tenantId: string;
  orgUnitId: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  periods: SchedulePeriod[];
}

export interface TimetableEntry {
  id: string;
  tenantId: string;
  orgUnitId: string;
  periodId: string;
  academicSessionId: string | null;
  instructorId: string | null;
  room: string | null;
  dayOfWeek: number | null;
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/** Timetable entries for an org unit (offering). Returns `[]` on error. */
export async function listTimetable(
  orgUnitId: string,
  tenantId: string = TENANT_ID,
): Promise<TimetableEntry[]> {
  try {
    const res = await fetch(
      `${CALENDAR_SERVICE_URL}/org-units/${encodeURIComponent(orgUnitId)}/timetable`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { entries: TimetableEntry[] };
    return data.entries ?? [];
  } catch {
    return [];
  }
}

/** Bell schedules (with periods) for an org unit. Returns `[]` on error. */
export async function listBellSchedules(
  orgUnitId: string,
  tenantId: string = TENANT_ID,
): Promise<BellSchedule[]> {
  try {
    const res = await fetch(
      `${CALENDAR_SERVICE_URL}/schedules?orgUnitId=${encodeURIComponent(orgUnitId)}`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { schedules: BellSchedule[] };
    return data.schedules ?? [];
  } catch {
    return [];
  }
}
