import type { TenantContext } from "@lms/types";

import type {
  ClassRecord,
  EnrollmentRecord,
  OrgRecord,
  UserRecord,
} from "./oneroster.js";

/**
 * Persistence + domain-upsert contract for the sis service (issue #14).
 *
 * The store owns the sis bookkeeping tables (`sis_sync`, `sis_id_map`) AND the
 * idempotent upserts into the domain tables other services own (`org_unit`,
 * `app_user`, `course`, `enrollment`) — every write runs under `withTenant` so
 * Postgres RLS scopes it to the caller's tenant (ADR-0014). The engine
 * (`sync.ts`) talks only to this interface and the OneRoster port, so it is
 * DB-free and network-free in tests. Pure mapping/report helpers live here too,
 * unit-testable without a store.
 */

export type EntityType =
  | "org"
  | "user"
  | "class"
  | "course"
  | "enrollment"
  | "academicSession";

export type SyncMode = "full" | "delta";
export type RunStatus = "running" | "succeeded" | "failed";

/** One `sis_sync` row = one sync run, carrying the report in `stats`. */
export interface SisSyncRun {
  id: string;
  tenantId: string;
  source: string;
  status: RunStatus | "idle";
  lastRunAt: string | null;
  stats: Record<string, unknown>;
}

export interface IdMapEntry {
  entityType: EntityType;
  sourceId: string;
  internalId: string;
  lastSeenAt: string;
}

/** Result of an idempotent domain upsert. */
export interface UpsertResult {
  internalId: string;
  created: boolean;
}

// ---------------------------------------------------------------------------
// Domain upsert input shapes. The engine resolves external parent references to
// internal ids (via the id-map) BEFORE calling the store, so these carry only
// resolved internal ids — the store never re-reads the id-map for parents.
// ---------------------------------------------------------------------------

export interface OrgUpsertInput {
  sourcedId: string;
  name: string;
  /** org_unit.type, already mapped from the OneRoster org type. */
  type: string;
  code: string | null;
  parentInternalId: string | null;
  isActive: boolean;
}

export interface UserUpsertInput {
  sourcedId: string;
  email: string;
  displayName: string;
  /** app_user.status ('active' | 'inactive' | 'invited'). */
  status: string;
}

export interface ClassUpsertInput {
  sourcedId: string;
  title: string;
  /** Owning school's internal org_unit id, or null if unmapped. */
  schoolInternalId: string | null;
}

export interface EnrollmentUpsertInput {
  sourcedId: string;
  userInternalId: string;
  /** The class's org_unit id. */
  orgUnitInternalId: string;
  roleId: string;
  /** enrollment.status ('active' | 'inactive' | 'completed' | 'withdrawn'). */
  status: string;
}

/** Upserting a class touches both org_unit and course. */
export interface ClassUpsertResult extends UpsertResult {
  courseId: string;
}

export interface SisStore {
  // --- run lifecycle (sis_sync) ---
  startSyncRun(
    ctx: TenantContext,
    input: { source: string; mode: SyncMode; since: string | null },
  ): Promise<SisSyncRun>;
  finishSyncRun(
    ctx: TenantContext,
    runId: string,
    input: { status: "succeeded" | "failed"; stats: Record<string, unknown> },
  ): Promise<SisSyncRun>;
  getSyncRun(ctx: TenantContext, runId: string): Promise<SisSyncRun | null>;
  listSyncRuns(
    ctx: TenantContext,
    opts?: { limit?: number },
  ): Promise<SisSyncRun[]>;
  /** Delta watermark: last succeeded run's last_run_at for tenant+source. */
  lastSuccessfulSyncAt(
    ctx: TenantContext,
    source: string,
  ): Promise<string | null>;

  // --- id-map (sis_id_map) ---
  lookupInternalId(
    ctx: TenantContext,
    entityType: EntityType,
    sourceId: string,
  ): Promise<string | null>;
  recordIdMap(
    ctx: TenantContext,
    entityType: EntityType,
    sourceId: string,
    internalId: string,
  ): Promise<void>;
  listIdMap(
    ctx: TenantContext,
    opts?: { entityType?: EntityType },
  ): Promise<IdMapEntry[]>;

  // --- domain upserts (RLS-scoped; also write sis_id_map in the same tx) ---
  upsertOrgUnit(ctx: TenantContext, input: OrgUpsertInput): Promise<UpsertResult>;
  upsertUser(ctx: TenantContext, input: UserUpsertInput): Promise<UpsertResult>;
  upsertCourseClass(
    ctx: TenantContext,
    input: ClassUpsertInput,
  ): Promise<ClassUpsertResult>;
  upsertEnrollment(
    ctx: TenantContext,
    input: EnrollmentUpsertInput,
  ): Promise<UpsertResult>;
  /** Resolve a tenant role id by name; null → enrollment conflict 'unknown_role'. */
  resolveRoleId(ctx: TenantContext, roleName: string): Promise<string | null>;
}

// ===========================================================================
// Pure helpers (no ctx, no store) — unit-tested in isolation.
// ===========================================================================

/** A mapping either yields an upsert input or a reason a record was rejected. */
export type MappingResult<T> =
  | { ok: true; input: T }
  | { ok: false; reason: string; detail: string };

/** Normalise a OneRoster role name onto the tenant's role-by-name lookup key. */
export function oneRosterRoleToName(role: string): string {
  const r = role.trim().toLowerCase();
  if (r === "primary" || r === "instructor") return "teacher";
  if (r === "guardian" || r === "parent") return "guardian";
  return r; // 'student' | 'teacher' | 'administrator' | 'aide' | ...
}

/** Map a OneRoster org type onto an org_unit.type the schema CHECK accepts. */
export function oneRosterOrgType(type: string): string {
  const t = type.trim().toLowerCase();
  if (t === "department") return "department";
  return "organization"; // district / school / unknown → top-level org
}

/** OneRoster status → app_user.status. */
function userStatus(status?: string): string {
  return status === "tobedeleted" || status === "inactive" ? "inactive" : "active";
}

/** OneRoster status → enrollment.status. */
function enrollmentStatus(status?: string): string {
  if (status === "tobedeleted") return "withdrawn";
  if (status === "inactive") return "inactive";
  if (status === "completed") return "completed";
  return "active";
}

export function mapOrg(rec: OrgRecord): MappingResult<OrgUpsertInput> {
  if (!rec.sourcedId) {
    return { ok: false, reason: "missing_sourced_id", detail: "org has no sourcedId" };
  }
  if (!rec.name || rec.name.trim().length === 0) {
    return {
      ok: false,
      reason: "missing_name",
      detail: `org '${rec.sourcedId}' has no name`,
    };
  }
  return {
    ok: true,
    input: {
      sourcedId: rec.sourcedId,
      name: rec.name.trim(),
      type: oneRosterOrgType(rec.type),
      code: null,
      parentInternalId: null, // resolved by the engine
      isActive: rec.status !== "tobedeleted",
    },
  };
}

export function mapOneRosterUserToUpsert(
  rec: UserRecord,
): MappingResult<UserUpsertInput> {
  if (!rec.sourcedId) {
    return { ok: false, reason: "missing_sourced_id", detail: "user has no sourcedId" };
  }
  if (!rec.email || rec.email.trim().length === 0) {
    return {
      ok: false,
      reason: "missing_email",
      detail: `OneRoster user '${rec.sourcedId}' has no email`,
    };
  }
  const display = `${rec.givenName ?? ""} ${rec.familyName ?? ""}`.trim();
  return {
    ok: true,
    input: {
      sourcedId: rec.sourcedId,
      email: rec.email.trim().toLowerCase(),
      displayName: display.length > 0 ? display : rec.email.trim(),
      status: userStatus(rec.status),
    },
  };
}

export function mapClass(rec: ClassRecord): MappingResult<ClassUpsertInput> {
  if (!rec.sourcedId) {
    return { ok: false, reason: "missing_sourced_id", detail: "class has no sourcedId" };
  }
  if (!rec.title || rec.title.trim().length === 0) {
    return {
      ok: false,
      reason: "missing_title",
      detail: `class '${rec.sourcedId}' has no title`,
    };
  }
  return {
    ok: true,
    input: {
      sourcedId: rec.sourcedId,
      title: rec.title.trim(),
      schoolInternalId: null, // resolved by the engine
    },
  };
}

export function mapEnrollment(
  rec: EnrollmentRecord,
): MappingResult<{
  sourcedId: string;
  classSourcedId: string;
  userSourcedId: string;
  roleName: string;
  status: string;
}> {
  if (!rec.sourcedId) {
    return {
      ok: false,
      reason: "missing_sourced_id",
      detail: "enrollment has no sourcedId",
    };
  }
  if (!rec.classSourcedId || !rec.userSourcedId) {
    return {
      ok: false,
      reason: "missing_reference",
      detail: `enrollment '${rec.sourcedId}' is missing a class or user reference`,
    };
  }
  return {
    ok: true,
    input: {
      sourcedId: rec.sourcedId,
      classSourcedId: rec.classSourcedId,
      userSourcedId: rec.userSourcedId,
      roleName: oneRosterRoleToName(rec.role),
      status: enrollmentStatus(rec.status),
    },
  };
}

// ---------------------------------------------------------------------------
// SyncReport accumulator — assembles the `sis_sync.stats` jsonb deterministically.
// ---------------------------------------------------------------------------

export type EntityKind = "orgs" | "users" | "classes" | "enrollments";
export type Outcome = "created" | "updated" | "skipped";

export interface EntityCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface ReportIssue {
  entityType: string;
  sourcedId: string;
  reason: string;
  detail: string;
}

/** The mutable accumulator the engine fills, serialised into `stats`. */
export interface SyncReport {
  mode: SyncMode;
  since: string | null;
  startedAt: string;
  finishedAt: string | null;
  counts: Record<EntityKind, EntityCounts>;
  conflicts: ReportIssue[];
  errors: ReportIssue[];
}

function emptyEntityCounts(): EntityCounts {
  return { fetched: 0, created: 0, updated: 0, skipped: 0 };
}

/** A fresh report for a run. */
export function newSyncReport(mode: SyncMode, since: string | null, startedAt: string): SyncReport {
  return {
    mode,
    since,
    startedAt,
    finishedAt: null,
    counts: {
      orgs: emptyEntityCounts(),
      users: emptyEntityCounts(),
      classes: emptyEntityCounts(),
      enrollments: emptyEntityCounts(),
    },
    conflicts: [],
    errors: [],
  };
}

/** Record that `fetched` records arrived for an entity kind. */
export function addFetched(report: SyncReport, kind: EntityKind, n: number): void {
  report.counts[kind].fetched += n;
}

/** Classify a store UpsertResult into created/updated and bump the counter. */
export function bumpOutcome(
  report: SyncReport,
  kind: EntityKind,
  outcome: Outcome,
): void {
  report.counts[kind][outcome] += 1;
}

export function addConflict(report: SyncReport, issue: ReportIssue): void {
  report.conflicts.push(issue);
}

export function addError(report: SyncReport, issue: ReportIssue): void {
  report.errors.push(issue);
}

/** Finalise the report into the `stats` jsonb payload. */
export function finishReport(
  report: SyncReport,
  finishedAt: string,
): Record<string, unknown> {
  report.finishedAt = finishedAt;
  return { ...report } as unknown as Record<string, unknown>;
}
