import { randomUUID } from "node:crypto";

import { EVENT_TYPES } from "@lms/events";
import type { TenantContext } from "@lms/types";

import {
  aggregateEvents,
  buildCourseEngagement,
  buildOrgUnitRollups,
  type AggregateDimension,
  type AnalyticsStore,
  type CaliperEventRecord,
  type CourseEngagementResult,
  type DeidentifiedAggregate,
  type EngagementSourceData,
  type EventFilter,
  type NewCaliperEventInput,
  type NewXapiStatementInput,
  type OrgUnitRollup,
  type RollupSourceData,
  type XapiStatementRecord,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

// Org-unit ids mirror the demo seed (packages/db/prisma/seed.demo.ts) so the
// memory store's rollup matches the DB-backed one for the demo tenant.
const DEMO_ROOT = "d0000000-0001-0000-0000-000000000001"; // org: "Demo School"
const DEMO_OFFERING = "d0000000-0002-0000-0000-000000000001"; // course offering
const DEMO_COURSE = "d0000000-0003-0000-0000-000000000001"; // course (course.id)
const DEMO_STUDENT = "d0000000-00a1-0000-0000-000000000002"; // the lone learner

/**
 * Reporting rollup source for the demo tenant, matching the seed: one school
 * (organization) with one course offering under it carrying 1 course,
 * 2 enrollments, 3 attendance records (P, T, P → 2 present), and one released
 * grade of 92%. Yields courseCount=1, enrollmentCount=2, attendanceRate=66.7,
 * averageGrade=92 — the numbers the integration evidence asserts.
 */
const DEMO_ROLLUP_SOURCE: RollupSourceData = {
  orgUnits: [
    { id: DEMO_ROOT, name: "Demo School", code: "DEMO", type: "organization", path: [] },
    {
      id: DEMO_OFFERING,
      name: "Intro to the Demo Platform (Section A)",
      code: "DEMO101-A",
      type: "course_offering",
      path: [DEMO_ROOT],
    },
  ],
  courses: [{ orgUnitId: DEMO_OFFERING }],
  enrollments: [{ orgUnitId: DEMO_OFFERING }, { orgUnitId: DEMO_OFFERING }],
  attendance: [
    { orgUnitId: DEMO_OFFERING, present: true }, // P
    { orgUnitId: DEMO_OFFERING, present: false }, // T (tardy → not present)
    { orgUnitId: DEMO_OFFERING, present: true }, // P
  ],
  grades: [{ orgUnitId: DEMO_OFFERING, pct: 92 }],
};

const EMPTY_ROLLUP_SOURCE: RollupSourceData = {
  orgUnits: [],
  courses: [],
  enrollments: [],
  attendance: [],
  grades: [],
};

/**
 * Engagement source for the demo course, matching the seed: one learner with
 * 3 attendance records (P, T, P → 2 present = 66.7%), 1 of 2 assignments
 * submitted (submissionRate 50%), and one released grade of 92%. Yields
 * score ≈ 69.6 and one HIGH-risk learner (low_attendance + missing_submissions).
 */
const DEMO_ENGAGEMENT_SOURCE: EngagementSourceData = {
  learnerIds: [DEMO_STUDENT],
  assignmentCount: 2,
  attendance: [
    { learnerId: DEMO_STUDENT, present: true }, // P
    { learnerId: DEMO_STUDENT, present: false }, // T (tardy → not present)
    { learnerId: DEMO_STUDENT, present: true }, // P
  ],
  submissions: [{ learnerId: DEMO_STUDENT }], // assignment 1 only
  grades: [{ learnerId: DEMO_STUDENT, pct: 92 }],
};

const EMPTY_ENGAGEMENT_SOURCE: EngagementSourceData = {
  learnerIds: [],
  assignmentCount: 0,
  attendance: [],
  submissions: [],
  grades: [],
};

interface OutboxRow {
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
}

function matches(e: CaliperEventRecord, f?: EventFilter): boolean {
  if (!f) return true;
  return (
    (f.type === undefined || e.type === f.type) &&
    (f.action === undefined || e.action === f.action) &&
    (f.from === undefined || e.eventTime >= f.from) &&
    (f.to === undefined || e.eventTime < f.to)
  );
}

/**
 * In-memory LRS. Rows are tenant-filtered to emulate RLS. Each Caliper event
 * also appends a `learning.event_captured` outbox row (exposed via
 * `emittedEvents()`), mirroring the single-transaction write the Prisma store
 * performs.
 */
export class MemoryAnalyticsStore implements AnalyticsStore {
  private events: CaliperEventRecord[] = [];
  private statements: XapiStatementRecord[] = [];
  private outbox: OutboxRow[] = [];
  // Read-only reporting source, tenant-scoped; only the demo tenant is seeded.
  private rollupSource: Map<string, RollupSourceData> = new Map([
    [DEMO_TENANT_ID, DEMO_ROLLUP_SOURCE],
  ]);
  // Per-course engagement source, tenant→(courseId→source); demo tenant only.
  private engagementSource: Map<string, Map<string, EngagementSourceData>> =
    new Map([[DEMO_TENANT_ID, new Map([[DEMO_COURSE, DEMO_ENGAGEMENT_SOURCE]])]]);

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Outbox rows recorded so far (test accessor). */
  emittedEvents(): readonly OutboxRow[] {
    return this.outbox;
  }

  async recordCaliperEvent(
    ctx: TenantContext,
    input: NewCaliperEventInput,
  ): Promise<CaliperEventRecord> {
    const event: CaliperEventRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      actorId: input.actorId ?? null,
      type: input.type,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      orgUnitId: input.orgUnitId ?? null,
      eventTime: input.eventTime ?? this.now().toISOString(),
      envelope: input.envelope ?? {},
    };
    this.events.push(event);
    this.outbox.push({
      tenantId: ctx.tenantId,
      type: EVENT_TYPES.LEARNING_EVENT_CAPTURED,
      payload: { caliperEventId: event.id, type: event.type, action: event.action },
    });
    return event;
  }

  async recordXapiStatement(
    ctx: TenantContext,
    input: NewXapiStatementInput,
  ): Promise<XapiStatementRecord> {
    const statement: XapiStatementRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      actorId: input.actorId ?? null,
      verb: input.verb,
      objectId: input.objectId,
      result: input.result ?? null,
      storedAt: this.now().toISOString(),
    };
    this.statements.push(statement);
    return statement;
  }

  async listEvents(
    ctx: TenantContext,
    filter?: EventFilter,
  ): Promise<CaliperEventRecord[]> {
    return this.events.filter(
      (e) => e.tenantId === ctx.tenantId && matches(e, filter),
    );
  }

  async aggregate(
    ctx: TenantContext,
    dimension: AggregateDimension,
    filter?: EventFilter,
  ): Promise<DeidentifiedAggregate> {
    const events = await this.listEvents(ctx, filter);
    return aggregateEvents(events, dimension);
  }

  async listOrgUnitRollups(ctx: TenantContext): Promise<OrgUnitRollup[]> {
    const data = this.rollupSource.get(ctx.tenantId) ?? EMPTY_ROLLUP_SOURCE;
    return buildOrgUnitRollups(data);
  }

  async getCourseEngagement(
    ctx: TenantContext,
    courseId: string,
  ): Promise<CourseEngagementResult> {
    const data =
      this.engagementSource.get(ctx.tenantId)?.get(courseId) ??
      EMPTY_ENGAGEMENT_SOURCE;
    return buildCourseEngagement(courseId, data);
  }
}
