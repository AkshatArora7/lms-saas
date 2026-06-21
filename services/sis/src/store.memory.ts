import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  ClassUpsertInput,
  ClassUpsertResult,
  EntityType,
  EnrollmentUpsertInput,
  IdMapEntry,
  OrgUpsertInput,
  SisStore,
  SisSyncRun,
  SyncMode,
  UpsertResult,
  UserUpsertInput,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** Tenant-scoped in-memory rows emulating the domain tables under RLS. */
interface OrgUnitRow {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  code: string | null;
  parentId: string | null;
}
interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  status: string;
  externalId: string;
}
interface CourseRow {
  id: string;
  tenantId: string;
  orgUnitId: string;
  title: string;
}
interface EnrollmentRow {
  id: string;
  tenantId: string;
  userId: string;
  orgUnitId: string;
  roleId: string;
  status: string;
}
interface RoleRow {
  id: string;
  tenantId: string;
  name: string;
}
interface IdMapRow extends IdMapEntry {
  tenantId: string;
}

/**
 * In-memory SisStore. Rows are tenant-filtered to emulate RLS (a different
 * tenant never sees another tenant's runs, mappings, or domain rows). Domain
 * upserts reconcile on the same natural keys the Prisma store uses
 * (`app_user (tenant,email)`, `course (org_unit_id)`,
 * `enrollment (user,org_unit)`) so re-running a sync updates rather than
 * duplicates. The demo tenant is seeded with the standard role names so
 * enrollments resolve.
 */
export class MemorySisStore implements SisStore {
  private runs: SisSyncRun[] = [];
  private idMap: IdMapRow[] = [];
  private orgUnits: OrgUnitRow[] = [];
  private users: UserRow[] = [];
  private courses: CourseRow[] = [];
  private enrollments: EnrollmentRow[] = [];
  private roles: RoleRow[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {
    // Seed the demo tenant with the conventional roles so enrollments resolve.
    for (const name of ["student", "teacher", "administrator"]) {
      this.roles.push({ id: this.generateId(), tenantId: DEMO_TENANT_ID, name });
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  // --- run lifecycle ---
  async startSyncRun(
    ctx: TenantContext,
    input: { source: string; mode: SyncMode; since: string | null },
  ): Promise<SisSyncRun> {
    const run: SisSyncRun = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      source: input.source,
      status: "running",
      lastRunAt: this.now(),
      stats: { mode: input.mode, since: input.since },
    };
    this.runs.push(run);
    return { ...run };
  }

  async finishSyncRun(
    ctx: TenantContext,
    runId: string,
    input: { status: "succeeded" | "failed"; stats: Record<string, unknown> },
  ): Promise<SisSyncRun> {
    const run = this.runs.find((r) => r.id === runId && r.tenantId === ctx.tenantId);
    if (!run) throw new Error("run not found");
    run.status = input.status;
    run.stats = input.stats;
    run.lastRunAt = this.now();
    return { ...run };
  }

  async getSyncRun(ctx: TenantContext, runId: string): Promise<SisSyncRun | null> {
    const run = this.runs.find((r) => r.id === runId && r.tenantId === ctx.tenantId);
    return run ? { ...run } : null;
  }

  async listSyncRuns(
    ctx: TenantContext,
    opts?: { limit?: number },
  ): Promise<SisSyncRun[]> {
    const mine = this.runs
      .filter((r) => r.tenantId === ctx.tenantId)
      .slice()
      .reverse()
      .map((r) => ({ ...r }));
    return opts?.limit ? mine.slice(0, opts.limit) : mine;
  }

  async lastSuccessfulSyncAt(
    ctx: TenantContext,
    source: string,
  ): Promise<string | null> {
    const ok = this.runs
      .filter(
        (r) =>
          r.tenantId === ctx.tenantId &&
          r.source === source &&
          r.status === "succeeded" &&
          r.lastRunAt !== null,
      )
      .map((r) => r.lastRunAt as string)
      .sort();
    return ok.length ? ok[ok.length - 1]! : null;
  }

  // --- id-map ---
  async lookupInternalId(
    ctx: TenantContext,
    entityType: EntityType,
    sourceId: string,
  ): Promise<string | null> {
    const row = this.idMap.find(
      (m) =>
        m.tenantId === ctx.tenantId &&
        m.entityType === entityType &&
        m.sourceId === sourceId,
    );
    return row ? row.internalId : null;
  }

  async recordIdMap(
    ctx: TenantContext,
    entityType: EntityType,
    sourceId: string,
    internalId: string,
  ): Promise<void> {
    const row = this.idMap.find(
      (m) =>
        m.tenantId === ctx.tenantId &&
        m.entityType === entityType &&
        m.sourceId === sourceId,
    );
    if (row) {
      row.internalId = internalId;
      row.lastSeenAt = this.now();
      return;
    }
    this.idMap.push({
      tenantId: ctx.tenantId,
      entityType,
      sourceId,
      internalId,
      lastSeenAt: this.now(),
    });
  }

  async listIdMap(
    ctx: TenantContext,
    opts?: { entityType?: EntityType },
  ): Promise<IdMapEntry[]> {
    return this.idMap
      .filter(
        (m) =>
          m.tenantId === ctx.tenantId &&
          (opts?.entityType === undefined || m.entityType === opts.entityType),
      )
      .map((m) => ({
        entityType: m.entityType,
        sourceId: m.sourceId,
        internalId: m.internalId,
        lastSeenAt: m.lastSeenAt,
      }));
  }

  // --- domain upserts ---
  async upsertOrgUnit(
    ctx: TenantContext,
    input: OrgUpsertInput,
  ): Promise<UpsertResult> {
    // Reconcile by the existing id-map mapping, else by (tenant,name,parent).
    const mappedId = await this.lookupInternalId(ctx, "org", input.sourcedId);
    let row = mappedId
      ? this.orgUnits.find((o) => o.id === mappedId && o.tenantId === ctx.tenantId)
      : this.orgUnits.find(
          (o) =>
            o.tenantId === ctx.tenantId &&
            o.name === input.name &&
            o.parentId === input.parentInternalId,
        );
    let created = false;
    if (!row) {
      row = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        type: input.type,
        name: input.name,
        code: input.code,
        parentId: input.parentInternalId,
      };
      this.orgUnits.push(row);
      created = true;
    } else {
      row.type = input.type;
      row.name = input.name;
      row.code = input.code;
      row.parentId = input.parentInternalId;
    }
    await this.recordIdMap(ctx, "org", input.sourcedId, row.id);
    return { internalId: row.id, created };
  }

  async upsertUser(
    ctx: TenantContext,
    input: UserUpsertInput,
  ): Promise<UpsertResult> {
    // Natural key: (tenant, email) — unique in the schema.
    let row = this.users.find(
      (u) => u.tenantId === ctx.tenantId && u.email === input.email,
    );
    let created = false;
    if (!row) {
      row = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        email: input.email,
        displayName: input.displayName,
        status: input.status,
        externalId: input.sourcedId,
      };
      this.users.push(row);
      created = true;
    } else {
      row.displayName = input.displayName;
      row.status = input.status;
      row.externalId = input.sourcedId;
    }
    await this.recordIdMap(ctx, "user", input.sourcedId, row.id);
    return { internalId: row.id, created };
  }

  async upsertCourseClass(
    ctx: TenantContext,
    input: ClassUpsertInput,
  ): Promise<ClassUpsertResult> {
    // A class = an org_unit (course_offering) under the school + a course row.
    const mappedId = await this.lookupInternalId(ctx, "class", input.sourcedId);
    let ou = mappedId
      ? this.orgUnits.find((o) => o.id === mappedId && o.tenantId === ctx.tenantId)
      : undefined;
    let created = false;
    if (!ou) {
      ou = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        type: "course_offering",
        name: input.title,
        code: null,
        parentId: input.schoolInternalId,
      };
      this.orgUnits.push(ou);
      created = true;
    } else {
      ou.name = input.title;
      ou.parentId = input.schoolInternalId;
    }
    // Course row is 1:1 on org_unit_id.
    let course = this.courses.find(
      (c) => c.tenantId === ctx.tenantId && c.orgUnitId === ou!.id,
    );
    if (!course) {
      course = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        orgUnitId: ou.id,
        title: input.title,
      };
      this.courses.push(course);
    } else {
      course.title = input.title;
    }
    await this.recordIdMap(ctx, "class", input.sourcedId, ou.id);
    await this.recordIdMap(ctx, "course", input.sourcedId, course.id);
    return { internalId: ou.id, courseId: course.id, created };
  }

  async upsertEnrollment(
    ctx: TenantContext,
    input: EnrollmentUpsertInput,
  ): Promise<UpsertResult> {
    // Natural key: (user_id, org_unit_id) — unique in the schema.
    let row = this.enrollments.find(
      (e) =>
        e.tenantId === ctx.tenantId &&
        e.userId === input.userInternalId &&
        e.orgUnitId === input.orgUnitInternalId,
    );
    let created = false;
    if (!row) {
      row = {
        id: this.generateId(),
        tenantId: ctx.tenantId,
        userId: input.userInternalId,
        orgUnitId: input.orgUnitInternalId,
        roleId: input.roleId,
        status: input.status,
      };
      this.enrollments.push(row);
      created = true;
    } else {
      row.roleId = input.roleId;
      row.status = input.status;
    }
    await this.recordIdMap(ctx, "enrollment", input.sourcedId, row.id);
    return { internalId: row.id, created };
  }

  async resolveRoleId(
    ctx: TenantContext,
    roleName: string,
  ): Promise<string | null> {
    const role = this.roles.find(
      (r) => r.tenantId === ctx.tenantId && r.name === roleName,
    );
    return role ? role.id : null;
  }
}

/** A memory store seeded for the demo tenant (roles already present). */
export function createSeededMemoryStore(): MemorySisStore {
  return new MemorySisStore();
}
