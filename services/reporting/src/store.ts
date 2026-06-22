import type { TenantContext } from "@lms/types";

/** Lifecycle of a persisted report execution (mirrors report_run.status CHECK). */
export type RunStatus = "queued" | "running" | "succeeded" | "failed";

/** A tenant's catalog entry for a built-in report (report_definition row). */
export interface ReportDefinition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  paramsSchema: Record<string, unknown>;
  createdAt: string;
}

/** One persisted execution of a report definition (report_run row). */
export interface ReportRun {
  id: string;
  definitionId: string;
  definitionKey: string;
  requestedBy: string | null;
  status: RunStatus;
  params: Record<string, unknown>;
  result: unknown | null;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * The fully-resolved state of a run to persist. The route executes the
 * {@link ../runner.ReportRunner} synchronously and hands the final outcome
 * (succeeded + result/rowCount, or failed + error) to {@link ReportStore.createRun}
 * in a single insert — there is no separate update step.
 */
export interface CreateRunInput {
  definitionId: string;
  definitionKey: string;
  requestedBy: string | null;
  status: RunStatus;
  params: Record<string, unknown>;
  result: unknown | null;
  rowCount: number | null;
  error: string | null;
  completedAt: string | null;
}

/**
 * Persistence boundary for the reporting service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the other domain services. Every
 * method is tenant-scoped (Postgres RLS in prod, an explicit tenant filter in
 * memory).
 */
export interface ReportStore {
  /** List the caller-tenant's report definitions (seeds the built-ins lazily). */
  listDefinitions(ctx: TenantContext): Promise<ReportDefinition[]>;

  /** Look up a single definition by its stable key, or null if unknown. */
  getDefinitionByKey(
    ctx: TenantContext,
    key: string,
  ): Promise<ReportDefinition | null>;

  /** Persist a fully-resolved run (succeeded or failed) and return it. */
  createRun(ctx: TenantContext, input: CreateRunInput): Promise<ReportRun>;

  /** Fetch a single run (incl. result) by id, or null if unknown. */
  getRun(ctx: TenantContext, id: string): Promise<ReportRun | null>;

  /** List the caller-tenant's runs, newest-first. */
  listRuns(ctx: TenantContext): Promise<ReportRun[]>;
}

/** Shape of a built-in report definition before it is seeded for a tenant. */
export interface BuiltinDefinition {
  key: string;
  name: string;
  description: string;
  paramsSchema: Record<string, unknown>;
}

/**
 * The built-in reports every tenant gets. Seeded lazily (memory: on first read;
 * prisma: idempotent upsert on (tenant_id, key)) so GET /definitions always
 * returns them. Heavy/scheduled/exported reports are deferred follow-ups.
 */
export const BUILTIN_DEFINITIONS: readonly BuiltinDefinition[] = [
  {
    key: "enrollment-summary",
    name: "Enrollment Summary",
    description:
      "Counts of enrollments grouped by status across the tenant.",
    paramsSchema: {},
  },
  {
    key: "course-completion-summary",
    name: "Course Completion Summary",
    description:
      "Per-course enrolled vs. completed enrollment counts across the tenant.",
    paramsSchema: {},
  },
] as const;

/** Pure: the set of valid built-in definition keys (unit-testable). */
export function isBuiltinDefinitionKey(key: string): boolean {
  return BUILTIN_DEFINITIONS.some((d) => d.key === key);
}
