import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type { EnrollmentRosterResolver } from "./enrollment-resolver.js";
import { FakeEnrollmentRosterResolver } from "./enrollment-resolver.memory.js";
import {
  attendanceEvent,
  recipientsFor,
  type AttendanceEvent,
} from "./events.js";
import { MemoryStudentGuardiansResolver } from "./guardians.memory.js";
import type { StudentGuardiansResolver } from "./guardians.js";
import {
  DEFAULT_ATTENDANCE_CODES,
  type AttendanceCategory,
  type AttendanceCodeRecord,
  type AttendanceExportRange,
  type AttendanceExportRow,
  type AttendanceHistoryEntry,
  type AttendanceRecordRecord,
  type AttendanceSessionRecord,
  type AttendanceStore,
  type CreateSessionResult,
  type NewAttendanceCodeInput,
  type NewSessionInput,
  type RecordInput,
  type SectionAttendanceSummary,
  type SetRecordsResult,
  type SisEntityType,
  type SisIdMapEntry,
  type StudentAttendanceSummary,
} from "./store.js";

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory AttendanceStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Summary/conflict
 * logic mirrors the Prisma store so behaviour is identical in dev/test and
 * prod. Used by the test suite and `ATTENDANCE_STORE=memory`.
 */
export class MemoryAttendanceStore implements AttendanceStore {
  private codes: AttendanceCodeRecord[] = [];
  private sessions: AttendanceSessionRecord[] = [];
  private records: AttendanceRecordRecord[] = [];
  private emitted: AttendanceEvent[] = [];
  /** sis_id_map rows, tenant-tagged, mirroring the RLS-isolated table (#377). */
  private sisMap: (SisIdMapEntry & { tenantId: string })[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    /** Resolves a student's notifiable guardians; defaults to none (#101). */
    private readonly guardians: StudentGuardiansResolver = new MemoryStudentGuardiansResolver(),
    /** Resolves a section's active roster for seeding; defaults to none (#376). */
    private readonly enrollment: EnrollmentRosterResolver = new FakeEnrollmentRosterResolver(),
  ) {}

  private codeCategory(
    tenantId: string,
    code: string,
  ): AttendanceCategory | null {
    return (
      this.codes.find((c) => c.tenantId === tenantId && c.code === code)
        ?.category ?? null
    );
  }

  async listCodes(ctx: TenantContext): Promise<AttendanceCodeRecord[]> {
    return this.codes.filter((c) => c.tenantId === ctx.tenantId);
  }

  async upsertCode(
    ctx: TenantContext,
    input: NewAttendanceCodeInput,
  ): Promise<AttendanceCodeRecord> {
    const existing = this.codes.find(
      (c) => c.tenantId === ctx.tenantId && c.code === input.code,
    );
    if (existing) {
      existing.label = input.label;
      existing.category = input.category;
      existing.isDefault = input.isDefault ?? false;
      return existing;
    }
    const record: AttendanceCodeRecord = {
      tenantId: ctx.tenantId,
      code: input.code,
      label: input.label,
      category: input.category,
      isDefault: input.isDefault ?? false,
    };
    this.codes.push(record);
    return record;
  }

  async seedDefaultCodes(
    ctx: TenantContext,
  ): Promise<AttendanceCodeRecord[]> {
    for (const code of DEFAULT_ATTENDANCE_CODES) {
      await this.upsertCode(ctx, code);
    }
    return this.listCodes(ctx);
  }

  async createSession(
    ctx: TenantContext,
    input: NewSessionInput,
  ): Promise<CreateSessionResult> {
    // Phase A: derive the roster from active section enrollment via the port,
    // outside any "tx" — mirrors the Prisma store's 2-phase flow (#376).
    const students = await this.enrollment.resolveRoster(ctx, input.orgUnitId);

    const periodLabel = input.periodLabel ?? null;
    const duplicate = this.sessions.some(
      (s) =>
        s.tenantId === ctx.tenantId &&
        s.orgUnitId === input.orgUnitId &&
        s.meetingDate === input.meetingDate &&
        s.periodLabel === periodLabel,
    );
    if (duplicate) return { ok: false, reason: "duplicate" };

    const session: AttendanceSessionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      orgUnitId: input.orgUnitId,
      timetableEntryId: input.timetableEntryId ?? null,
      meetingDate: input.meetingDate,
      periodLabel,
      status: "open",
      takenBy: input.takenBy ?? null,
    };
    this.sessions.push(session);

    // Seed one record per active student with the tenant's default code. The
    // (sessionId, userId) dedup mirrors ON CONFLICT DO NOTHING, and a missing
    // default code skips seeding (FK would forbid a code-less record) (#376).
    if (students.length > 0) {
      const defaultCode = this.codes.find(
        (c) => c.tenantId === ctx.tenantId && c.isDefault,
      )?.code;
      if (defaultCode) {
        for (const s of students) {
          const exists = this.records.some(
            (r) => r.sessionId === session.id && r.userId === s.userId,
          );
          if (exists) continue;
          this.records.push({
            id: this.generateId(),
            tenantId: ctx.tenantId,
            sessionId: session.id,
            userId: s.userId,
            code: defaultCode,
            minutesLate: null,
            comment: null,
          });
        }
      }
    }

    return { ok: true, session };
  }

  async getSession(
    ctx: TenantContext,
    id: string,
  ): Promise<{
    session: AttendanceSessionRecord;
    records: AttendanceRecordRecord[];
  } | null> {
    const session = this.sessions.find(
      (s) => s.id === id && s.tenantId === ctx.tenantId,
    );
    if (!session) return null;
    return {
      session,
      records: this.records.filter((r) => r.sessionId === id),
    };
  }

  async setRecords(
    ctx: TenantContext,
    sessionId: string,
    records: RecordInput[],
  ): Promise<SetRecordsResult> {
    const session = this.sessions.find(
      (s) => s.id === sessionId && s.tenantId === ctx.tenantId,
    );
    if (!session) return { ok: false, reason: "finalized" };
    if (session.status === "finalized") {
      return { ok: false, reason: "finalized" };
    }
    for (const r of records) {
      if (this.codeCategory(ctx.tenantId, r.code) === null) {
        return { ok: false, reason: "unknown_code" };
      }
    }

    for (const r of records) {
      const existing = this.records.find(
        (x) => x.sessionId === sessionId && x.userId === r.userId,
      );
      if (existing) {
        existing.code = r.code;
        existing.minutesLate = r.minutesLate ?? null;
        existing.comment = r.comment ?? null;
      } else {
        this.records.push({
          id: this.generateId(),
          tenantId: ctx.tenantId,
          sessionId,
          userId: r.userId,
          code: r.code,
          minutesLate: r.minutesLate ?? null,
          comment: r.comment ?? null,
        });
      }
    }
    return {
      ok: true,
      records: this.records.filter((r) => r.sessionId === sessionId),
    };
  }

  async finalizeSession(
    ctx: TenantContext,
    id: string,
  ): Promise<AttendanceSessionRecord | null> {
    const session = this.sessions.find(
      (s) => s.id === id && s.tenantId === ctx.tenantId,
    );
    if (!session) return null;
    session.status = "finalized";
    // Emit a flagged event for each absent/tardy record in the session. The
    // recipient list is the learner plus their active+consented guardians,
    // resolved per record through the port (#101) and deduped.
    for (const r of this.records.filter((x) => x.sessionId === id)) {
      const category = this.codeCategory(ctx.tenantId, r.code);
      if (category === "absent" || category === "tardy") {
        const gs = await this.guardians.resolveGuardians(ctx, r.userId);
        const recipientIds = recipientsFor(
          r.userId,
          gs.map((g) => g.guardianUserId),
        );
        this.emitted.push(
          attendanceEvent(
            id,
            session.orgUnitId,
            { userId: r.userId, code: r.code, category },
            recipientIds,
          ),
        );
      }
    }
    return session;
  }

  /** Outbox events emitted on finalize (for test assertions). */
  emittedEvents(): AttendanceEvent[] {
    return this.emitted;
  }

  async sectionSummary(
    ctx: TenantContext,
    orgUnitId: string,
    chronicAbsenceThreshold: number,
  ): Promise<SectionAttendanceSummary> {
    const sessionIds = new Set(
      this.sessions
        .filter(
          (s) => s.tenantId === ctx.tenantId && s.orgUnitId === orgUnitId,
        )
        .map((s) => s.id),
    );
    const relevant = this.records.filter((r) => sessionIds.has(r.sessionId));

    const byUser = new Map<string, StudentAttendanceSummary>();
    for (const r of relevant) {
      const category = this.codeCategory(ctx.tenantId, r.code);
      if (!category) continue;
      let s = byUser.get(r.userId);
      if (!s) {
        s = {
          userId: r.userId,
          total: 0,
          present: 0,
          absent: 0,
          tardy: 0,
          excused: 0,
          absenceRate: 0,
          chronicAbsence: false,
        };
        byUser.set(r.userId, s);
      }
      s.total += 1;
      s[category] += 1;
    }

    const students = [...byUser.values()].map((s) => {
      const absenceRate = s.total > 0 ? s.absent / s.total : 0;
      return {
        ...s,
        absenceRate,
        chronicAbsence: absenceRate >= chronicAbsenceThreshold,
      };
    });

    return { orgUnitId, chronicAbsenceThreshold, students };
  }

  async userHistory(
    ctx: TenantContext,
    userId: string,
  ): Promise<AttendanceHistoryEntry[]> {
    const sessionsById = new Map(
      this.sessions
        .filter((s) => s.tenantId === ctx.tenantId)
        .map((s) => [s.id, s]),
    );
    return this.records
      .filter((r) => r.tenantId === ctx.tenantId && r.userId === userId)
      .flatMap((r) => {
        const session = sessionsById.get(r.sessionId);
        if (!session) return [];
        return [
          {
            sessionId: r.sessionId,
            orgUnitId: session.orgUnitId,
            meetingDate: session.meetingDate,
            periodLabel: session.periodLabel,
            code: r.code,
            category:
              this.codeCategory(ctx.tenantId, r.code) ?? "present",
            minutesLate: r.minutesLate,
          },
        ];
      });
  }

  async exportAttendance(
    ctx: TenantContext,
    range: AttendanceExportRange,
  ): Promise<AttendanceExportRow[]> {
    const sectionId = range.sectionId ?? null;
    const sessionsById = new Map(
      this.sessions
        .filter((s) => s.tenantId === ctx.tenantId)
        .map((s) => [s.id, s]),
    );
    return this.records
      .filter((r) => r.tenantId === ctx.tenantId)
      .flatMap((r) => {
        const session = sessionsById.get(r.sessionId);
        if (!session) return [];
        if (session.meetingDate < range.from || session.meetingDate > range.to) {
          return [];
        }
        if (sectionId !== null && session.orgUnitId !== sectionId) return [];
        const category = this.codeCategory(ctx.tenantId, r.code) ?? "present";
        return [
          {
            tenantId: ctx.tenantId,
            sessionId: r.sessionId,
            orgUnitId: session.orgUnitId,
            meetingDate: session.meetingDate,
            periodLabel: session.periodLabel,
            userId: r.userId,
            code: r.code,
            category,
            minutesLate: r.minutesLate,
            comment: r.comment,
          },
        ];
      })
      .sort((a, b) => {
        if (a.meetingDate !== b.meetingDate) {
          return a.meetingDate < b.meetingDate ? -1 : 1;
        }
        if (a.orgUnitId !== b.orgUnitId) {
          return a.orgUnitId < b.orgUnitId ? -1 : 1;
        }
        return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
      });
  }

  async sisIdMap(
    ctx: TenantContext,
    entityTypes: readonly SisEntityType[],
    internalIds: readonly string[],
  ): Promise<SisIdMapEntry[]> {
    const wantedTypes = new Set(entityTypes);
    const wantedIds = new Set(internalIds);
    return this.sisMap
      .filter(
        (m) =>
          m.tenantId === ctx.tenantId &&
          wantedTypes.has(m.entityType) &&
          wantedIds.has(m.internalId),
      )
      .map(({ tenantId: _tenantId, ...entry }) => entry);
  }

  /** Seed a sis_id_map entry for a tenant (test/dev convenience, #377). */
  seedSisIdMap(
    tenantId: string,
    entry: SisIdMapEntry,
  ): void {
    this.sisMap.push({ tenantId, ...entry });
  }
}

/** Build a MemoryAttendanceStore pre-seeded with default codes for the demo tenant. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
  guardians: StudentGuardiansResolver = new MemoryStudentGuardiansResolver(),
  enrollment: EnrollmentRosterResolver = new FakeEnrollmentRosterResolver(),
): MemoryAttendanceStore {
  const store = new MemoryAttendanceStore(generateId, guardians, enrollment);
  void store.seedDefaultCodes({
    tenantId: DEMO_TENANT_ID,
    tier: "pool",
    databaseUrl: "postgres://demo:demo@localhost:5432/demo",
  });
  return store;
}
