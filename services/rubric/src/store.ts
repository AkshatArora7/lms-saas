import type { TenantContext } from "@lms/types";

export type RubricKind = "analytic" | "holistic";

export const RUBRIC_KINDS: readonly RubricKind[] = ["analytic", "holistic"];

/** Targets an objective can align to (mirrors the schema CHECK). */
export type AlignmentTarget =
  | "quiz"
  | "assignment"
  | "question"
  | "rubric_criterion";

export const ALIGNMENT_TARGETS: readonly AlignmentTarget[] = [
  "quiz",
  "assignment",
  "question",
  "rubric_criterion",
];

export interface RubricLevelRecord {
  id: string;
  tenantId: string;
  criterionId: string;
  label: string;
  points: number;
  descriptor: string | null;
}

export interface RubricCriterionRecord {
  id: string;
  tenantId: string;
  rubricId: string;
  name: string;
  position: number;
  levels: RubricLevelRecord[];
}

export interface RubricRecord {
  id: string;
  tenantId: string;
  courseId: string | null;
  name: string;
  kind: RubricKind;
}

/** A rubric with its full criteria × levels grid. */
export interface RubricDetail extends RubricRecord {
  criteria: RubricCriterionRecord[];
}

export interface NewLevelInput {
  label: string;
  points: number;
  descriptor?: string | null;
}

export interface NewCriterionInput {
  name: string;
  position?: number;
  levels?: NewLevelInput[];
}

export interface NewRubricInput {
  name: string;
  kind?: RubricKind;
  courseId?: string | null;
  criteria?: NewCriterionInput[];
}

/** One picked level per criterion, used to score a rubric. */
export interface ScoreSelection {
  criterionId: string;
  levelId: string;
}

export interface ScoreLine {
  criterionId: string;
  levelId: string;
  points: number;
}

/**
 * Result of scoring a rubric against picked levels. `total` is the sum of the
 * picked level points; `max` is the sum of each criterion's highest level.
 * Posting `total` to a gradebook line item is the grading service's job.
 */
export interface RubricScore {
  rubricId: string;
  total: number;
  max: number;
  lines: ScoreLine[];
}

export type ScoreRubricResult =
  | { ok: true; score: RubricScore }
  | {
      ok: false;
      reason: "rubric_not_found" | "invalid_selection";
      message: string;
    };

export interface CompetencyRecord {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  description: string | null;
}

export interface NewCompetencyInput {
  name: string;
  parentId?: string | null;
  description?: string | null;
}

export interface ObjectiveRecord {
  id: string;
  tenantId: string;
  competencyId: string | null;
  code: string | null;
  statement: string;
}

export interface NewObjectiveInput {
  statement: string;
  competencyId?: string | null;
  code?: string | null;
}

export interface AlignmentRecord {
  id: string;
  tenantId: string;
  objectiveId: string;
  targetType: AlignmentTarget;
  targetId: string;
}

export interface NewAlignmentInput {
  targetType: AlignmentTarget;
  targetId: string;
}

export type CreateCompetencyResult =
  | { ok: true; competency: CompetencyRecord }
  | { ok: false; reason: "unknown_parent" };

export type CreateObjectiveResult =
  | { ok: true; objective: ObjectiveRecord }
  | { ok: false; reason: "unknown_competency" };

export type AlignResult =
  | { ok: true; alignment: AlignmentRecord }
  | { ok: false; reason: "unknown_objective" };

/**
 * Persistence boundary for the rubric service (rubrics, competencies,
 * outcomes). Routes depend only on this interface, so production uses an
 * RLS-scoped Postgres implementation while tests inject an in-memory one —
 * mirroring the enrollment/user-org services.
 */
export interface RubricStore {
  // --- Rubrics (story #49) ---
  createRubric(
    ctx: TenantContext,
    input: NewRubricInput,
  ): Promise<RubricDetail>;

  getRubric(ctx: TenantContext, id: string): Promise<RubricDetail | null>;

  listRubrics(
    ctx: TenantContext,
    courseId?: string,
  ): Promise<RubricRecord[]>;

  addCriterion(
    ctx: TenantContext,
    rubricId: string,
    input: NewCriterionInput,
  ): Promise<RubricCriterionRecord | null>;

  deleteRubric(ctx: TenantContext, id: string): Promise<boolean>;

  /** Score a rubric against one picked level per criterion (pure tally). */
  scoreRubric(
    ctx: TenantContext,
    rubricId: string,
    selections: ScoreSelection[],
  ): Promise<ScoreRubricResult>;

  // --- Competencies & outcomes (story #50) ---
  createCompetency(
    ctx: TenantContext,
    input: NewCompetencyInput,
  ): Promise<CreateCompetencyResult>;

  listCompetencies(ctx: TenantContext): Promise<CompetencyRecord[]>;

  createObjective(
    ctx: TenantContext,
    input: NewObjectiveInput,
  ): Promise<CreateObjectiveResult>;

  listObjectives(
    ctx: TenantContext,
    competencyId?: string,
  ): Promise<ObjectiveRecord[]>;

  alignObjective(
    ctx: TenantContext,
    objectiveId: string,
    input: NewAlignmentInput,
  ): Promise<AlignResult>;

  listAlignmentsForObjective(
    ctx: TenantContext,
    objectiveId: string,
  ): Promise<AlignmentRecord[]>;

  /** Reverse lookup: objectives aligned to a given activity. */
  listObjectivesForTarget(
    ctx: TenantContext,
    targetType: AlignmentTarget,
    targetId: string,
  ): Promise<ObjectiveRecord[]>;
}
