import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import { computeRubricScore } from "./scoring.js";
import type {
  AlignResult,
  AlignmentRecord,
  AlignmentTarget,
  CompetencyRecord,
  CreateCompetencyResult,
  CreateObjectiveResult,
  NewAlignmentInput,
  NewCompetencyInput,
  NewCriterionInput,
  NewObjectiveInput,
  NewRubricInput,
  ObjectiveRecord,
  RubricCriterionRecord,
  RubricDetail,
  RubricRecord,
  RubricStore,
  ScoreRubricResult,
  ScoreSelection,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface StoredRubric extends RubricRecord {
  criteria: RubricCriterionRecord[];
}

/**
 * In-memory RubricStore. Rows are filtered by tenant id to emulate the
 * row-level isolation Postgres RLS enforces in production. Used by the test
 * suite and `RUBRIC_STORE=memory`.
 */
export class MemoryRubricStore implements RubricStore {
  private rubrics: StoredRubric[] = [];
  private competencies: CompetencyRecord[] = [];
  private objectives: ObjectiveRecord[] = [];
  private alignments: AlignmentRecord[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {}

  private buildCriterion(
    tenantId: string,
    rubricId: string,
    input: NewCriterionInput,
    position: number,
  ): RubricCriterionRecord {
    return {
      id: this.generateId(),
      tenantId,
      rubricId,
      name: input.name,
      position: input.position ?? position,
      levels: (input.levels ?? []).map((l) => ({
        id: this.generateId(),
        tenantId,
        criterionId: "", // set below
        label: l.label,
        points: l.points,
        descriptor: l.descriptor ?? null,
      })),
    };
  }

  async createRubric(
    ctx: TenantContext,
    input: NewRubricInput,
  ): Promise<RubricDetail> {
    const id = this.generateId();
    const criteria = (input.criteria ?? []).map((c, i) => {
      const criterion = this.buildCriterion(ctx.tenantId, id, c, i);
      criterion.levels = criterion.levels.map((l) => ({
        ...l,
        criterionId: criterion.id,
      }));
      return criterion;
    });
    const rubric: StoredRubric = {
      id,
      tenantId: ctx.tenantId,
      courseId: input.courseId ?? null,
      name: input.name,
      kind: input.kind ?? "analytic",
      criteria,
    };
    this.rubrics.push(rubric);
    return rubric;
  }

  async getRubric(
    ctx: TenantContext,
    id: string,
  ): Promise<RubricDetail | null> {
    return (
      this.rubrics.find((r) => r.id === id && r.tenantId === ctx.tenantId) ??
      null
    );
  }

  async listRubrics(
    ctx: TenantContext,
    courseId?: string,
  ): Promise<RubricRecord[]> {
    return this.rubrics
      .filter(
        (r) =>
          r.tenantId === ctx.tenantId &&
          (courseId === undefined || r.courseId === courseId),
      )
      .map(({ criteria: _c, ...r }) => r);
  }

  async addCriterion(
    ctx: TenantContext,
    rubricId: string,
    input: NewCriterionInput,
  ): Promise<RubricCriterionRecord | null> {
    const rubric = this.rubrics.find(
      (r) => r.id === rubricId && r.tenantId === ctx.tenantId,
    );
    if (!rubric) return null;
    const criterion = this.buildCriterion(
      ctx.tenantId,
      rubricId,
      input,
      rubric.criteria.length,
    );
    criterion.levels = criterion.levels.map((l) => ({
      ...l,
      criterionId: criterion.id,
    }));
    rubric.criteria.push(criterion);
    return criterion;
  }

  async deleteRubric(ctx: TenantContext, id: string): Promise<boolean> {
    const idx = this.rubrics.findIndex(
      (r) => r.id === id && r.tenantId === ctx.tenantId,
    );
    if (idx === -1) return false;
    this.rubrics.splice(idx, 1);
    return true;
  }

  async scoreRubric(
    ctx: TenantContext,
    rubricId: string,
    selections: ScoreSelection[],
  ): Promise<ScoreRubricResult> {
    const rubric = this.rubrics.find(
      (r) => r.id === rubricId && r.tenantId === ctx.tenantId,
    );
    if (!rubric) {
      return {
        ok: false,
        reason: "rubric_not_found",
        message: "Rubric not found.",
      };
    }
    return computeRubricScore(rubric, selections);
  }

  async createCompetency(
    ctx: TenantContext,
    input: NewCompetencyInput,
  ): Promise<CreateCompetencyResult> {
    if (input.parentId) {
      const parent = this.competencies.find(
        (c) => c.id === input.parentId && c.tenantId === ctx.tenantId,
      );
      if (!parent) return { ok: false, reason: "unknown_parent" };
    }
    const competency: CompetencyRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      parentId: input.parentId ?? null,
      name: input.name,
      description: input.description ?? null,
    };
    this.competencies.push(competency);
    return { ok: true, competency };
  }

  async listCompetencies(ctx: TenantContext): Promise<CompetencyRecord[]> {
    return this.competencies.filter((c) => c.tenantId === ctx.tenantId);
  }

  async createObjective(
    ctx: TenantContext,
    input: NewObjectiveInput,
  ): Promise<CreateObjectiveResult> {
    if (input.competencyId) {
      const comp = this.competencies.find(
        (c) => c.id === input.competencyId && c.tenantId === ctx.tenantId,
      );
      if (!comp) return { ok: false, reason: "unknown_competency" };
    }
    const objective: ObjectiveRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      competencyId: input.competencyId ?? null,
      code: input.code ?? null,
      statement: input.statement,
    };
    this.objectives.push(objective);
    return { ok: true, objective };
  }

  async listObjectives(
    ctx: TenantContext,
    competencyId?: string,
  ): Promise<ObjectiveRecord[]> {
    return this.objectives.filter(
      (o) =>
        o.tenantId === ctx.tenantId &&
        (competencyId === undefined || o.competencyId === competencyId),
    );
  }

  async alignObjective(
    ctx: TenantContext,
    objectiveId: string,
    input: NewAlignmentInput,
  ): Promise<AlignResult> {
    const objective = this.objectives.find(
      (o) => o.id === objectiveId && o.tenantId === ctx.tenantId,
    );
    if (!objective) return { ok: false, reason: "unknown_objective" };
    const alignment: AlignmentRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      objectiveId,
      targetType: input.targetType,
      targetId: input.targetId,
    };
    this.alignments.push(alignment);
    return { ok: true, alignment };
  }

  async listAlignmentsForObjective(
    ctx: TenantContext,
    objectiveId: string,
  ): Promise<AlignmentRecord[]> {
    return this.alignments.filter(
      (a) => a.tenantId === ctx.tenantId && a.objectiveId === objectiveId,
    );
  }

  async listObjectivesForTarget(
    ctx: TenantContext,
    targetType: AlignmentTarget,
    targetId: string,
  ): Promise<ObjectiveRecord[]> {
    const objIds = new Set(
      this.alignments
        .filter(
          (a) =>
            a.tenantId === ctx.tenantId &&
            a.targetType === targetType &&
            a.targetId === targetId,
        )
        .map((a) => a.objectiveId),
    );
    return this.objectives.filter(
      (o) => o.tenantId === ctx.tenantId && objIds.has(o.id),
    );
  }
}
