import { withTenant } from "@lms/db";

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
  RubricKind,
  RubricRecord,
  RubricStore,
  ScoreRubricResult,
  ScoreSelection,
} from "./store.js";

interface RubricRow {
  id: string;
  tenant_id: string;
  course_id: string | null;
  name: string;
  kind: RubricKind;
}
interface CriterionRow {
  id: string;
  tenant_id: string;
  rubric_id: string;
  name: string;
  position: number;
}
interface LevelRow {
  id: string;
  tenant_id: string;
  criterion_id: string;
  label: string;
  points: string | number;
  descriptor: string | null;
}
interface CompetencyRow {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
}
interface ObjectiveRow {
  id: string;
  tenant_id: string;
  competency_id: string | null;
  code: string | null;
  statement: string;
}
interface AlignmentRow {
  id: string;
  tenant_id: string;
  objective_id: string;
  target_type: AlignmentTarget;
  target_id: string;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function toRubric(row: RubricRow): RubricRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    courseId: row.course_id,
    name: row.name,
    kind: row.kind,
  };
}
function toCompetency(row: CompetencyRow): CompetencyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
  };
}
function toObjective(row: ObjectiveRow): ObjectiveRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    competencyId: row.competency_id,
    code: row.code,
    statement: row.statement,
  };
}
function toAlignment(row: AlignmentRow): AlignmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    objectiveId: row.objective_id,
    targetType: row.target_type,
    targetId: row.target_id,
  };
}

/** Assemble the full criteria × levels grid for a rubric (already RLS-scoped). */
async function loadGrid(
  db: Db,
  rubricId: string,
): Promise<RubricCriterionRecord[]> {
  const criteria = await db.$queryRawUnsafe<CriterionRow[]>(
    `SELECT id, tenant_id, rubric_id, name, position
       FROM rubric_criterion WHERE rubric_id = $1::uuid
      ORDER BY position, name`,
    rubricId,
  );
  if (criteria.length === 0) return [];
  const ids = criteria.map((c) => c.id);
  const levels = await db.$queryRawUnsafe<LevelRow[]>(
    `SELECT id, tenant_id, criterion_id, label, points, descriptor
       FROM rubric_level WHERE criterion_id = ANY($1::uuid[])
      ORDER BY points DESC`,
    ids,
  );
  return criteria.map((c) => ({
    id: c.id,
    tenantId: c.tenant_id,
    rubricId: c.rubric_id,
    name: c.name,
    position: c.position,
    levels: levels
      .filter((l) => l.criterion_id === c.id)
      .map((l) => ({
        id: l.id,
        tenantId: l.tenant_id,
        criterionId: l.criterion_id,
        label: l.label,
        points: Number(l.points),
        descriptor: l.descriptor,
      })),
  }));
}

async function insertCriterion(
  db: Db,
  tenantId: string,
  rubricId: string,
  input: NewCriterionInput,
  fallbackPosition: number,
): Promise<RubricCriterionRecord> {
  const rows = await db.$queryRawUnsafe<CriterionRow[]>(
    `INSERT INTO rubric_criterion (tenant_id, rubric_id, name, position)
     VALUES ($1::uuid, $2::uuid, $3, $4)
     RETURNING id, tenant_id, rubric_id, name, position`,
    tenantId,
    rubricId,
    input.name,
    input.position ?? fallbackPosition,
  );
  const criterion = rows[0]!;
  const levels = [];
  for (const lvl of input.levels ?? []) {
    const lvlRows = await db.$queryRawUnsafe<LevelRow[]>(
      `INSERT INTO rubric_level (tenant_id, criterion_id, label, points, descriptor)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)
       RETURNING id, tenant_id, criterion_id, label, points, descriptor`,
      tenantId,
      criterion.id,
      lvl.label,
      lvl.points,
      lvl.descriptor ?? null,
    );
    const l = lvlRows[0]!;
    levels.push({
      id: l.id,
      tenantId: l.tenant_id,
      criterionId: l.criterion_id,
      label: l.label,
      points: Number(l.points),
      descriptor: l.descriptor,
    });
  }
  return {
    id: criterion.id,
    tenantId: criterion.tenant_id,
    rubricId: criterion.rubric_id,
    name: criterion.name,
    position: criterion.position,
    levels,
  };
}

/**
 * Postgres-backed rubric store. Every call runs through `withTenant`, so all
 * statements execute inside an RLS-scoped transaction — rows can never leak
 * across tenants. Every uuid parameter is cast `::uuid` (Prisma's
 * $queryRawUnsafe binds string args as text, which Postgres won't coerce).
 */
export function createPrismaStore(): RubricStore {
  return {
    async createRubric(ctx, input: NewRubricInput): Promise<RubricDetail> {
      return withTenant(ctx, async (db) => {
        const rubricRows = await db.$queryRawUnsafe<RubricRow[]>(
          `INSERT INTO rubric (tenant_id, course_id, name, kind)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           RETURNING id, tenant_id, course_id, name, kind`,
          ctx.tenantId,
          input.courseId ?? null,
          input.name,
          input.kind ?? "analytic",
        );
        const rubric = toRubric(rubricRows[0]!);
        const criteria = [];
        let i = 0;
        for (const c of input.criteria ?? []) {
          criteria.push(await insertCriterion(db, ctx.tenantId, rubric.id, c, i));
          i += 1;
        }
        return { ...rubric, criteria };
      });
    },

    async getRubric(ctx, id): Promise<RubricDetail | null> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<RubricRow[]>(
          `SELECT id, tenant_id, course_id, name, kind
             FROM rubric WHERE id = $1::uuid LIMIT 1`,
          id,
        );
        if (rows.length === 0) return null;
        return { ...toRubric(rows[0]!), criteria: await loadGrid(db, id) };
      });
    },

    async listRubrics(ctx, courseId): Promise<RubricRecord[]> {
      return withTenant(ctx, async (db) => {
        const rows = courseId
          ? await db.$queryRawUnsafe<RubricRow[]>(
              `SELECT id, tenant_id, course_id, name, kind
                 FROM rubric WHERE course_id = $1::uuid ORDER BY name`,
              courseId,
            )
          : await db.$queryRawUnsafe<RubricRow[]>(
              `SELECT id, tenant_id, course_id, name, kind
                 FROM rubric ORDER BY name`,
            );
        return rows.map(toRubric);
      });
    },

    async addCriterion(
      ctx,
      rubricId,
      input: NewCriterionInput,
    ): Promise<RubricCriterionRecord | null> {
      return withTenant(ctx, async (db) => {
        const rubric = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM rubric WHERE id = $1::uuid LIMIT 1`,
          rubricId,
        );
        if (rubric.length === 0) return null;
        const count = await db.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int AS n FROM rubric_criterion
            WHERE rubric_id = $1::uuid`,
          rubricId,
        );
        return insertCriterion(
          db,
          ctx.tenantId,
          rubricId,
          input,
          count[0]?.n ?? 0,
        );
      });
    },

    async deleteRubric(ctx, id): Promise<boolean> {
      return withTenant(ctx, async (db) => {
        const affected = await db.$executeRawUnsafe(
          `DELETE FROM rubric WHERE id = $1::uuid`,
          id,
        );
        return affected > 0;
      });
    },

    async scoreRubric(
      ctx,
      rubricId,
      selections: ScoreSelection[],
    ): Promise<ScoreRubricResult> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<RubricRow[]>(
          `SELECT id, tenant_id, course_id, name, kind
             FROM rubric WHERE id = $1::uuid LIMIT 1`,
          rubricId,
        );
        if (rows.length === 0) {
          return {
            ok: false,
            reason: "rubric_not_found",
            message: "Rubric not found.",
          };
        }
        const detail: RubricDetail = {
          ...toRubric(rows[0]!),
          criteria: await loadGrid(db, rubricId),
        };
        return computeRubricScore(detail, selections);
      });
    },

    async createCompetency(
      ctx,
      input: NewCompetencyInput,
    ): Promise<CreateCompetencyResult> {
      return withTenant<CreateCompetencyResult>(ctx, async (db) => {
        if (input.parentId) {
          const parent = await db.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM competency WHERE id = $1::uuid LIMIT 1`,
            input.parentId,
          );
          if (parent.length === 0) return { ok: false, reason: "unknown_parent" };
        }
        const rows = await db.$queryRawUnsafe<CompetencyRow[]>(
          `INSERT INTO competency (tenant_id, parent_id, name, description)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           RETURNING id, tenant_id, parent_id, name, description`,
          ctx.tenantId,
          input.parentId ?? null,
          input.name,
          input.description ?? null,
        );
        return { ok: true, competency: toCompetency(rows[0]!) };
      });
    },

    async listCompetencies(ctx): Promise<CompetencyRecord[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<CompetencyRow[]>(
          `SELECT id, tenant_id, parent_id, name, description
             FROM competency ORDER BY name`,
        );
        return rows.map(toCompetency);
      });
    },

    async createObjective(
      ctx,
      input: NewObjectiveInput,
    ): Promise<CreateObjectiveResult> {
      return withTenant<CreateObjectiveResult>(ctx, async (db) => {
        if (input.competencyId) {
          const comp = await db.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM competency WHERE id = $1::uuid LIMIT 1`,
            input.competencyId,
          );
          if (comp.length === 0) {
            return { ok: false, reason: "unknown_competency" };
          }
        }
        const rows = await db.$queryRawUnsafe<ObjectiveRow[]>(
          `INSERT INTO learning_objective (tenant_id, competency_id, code, statement)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           RETURNING id, tenant_id, competency_id, code, statement`,
          ctx.tenantId,
          input.competencyId ?? null,
          input.code ?? null,
          input.statement,
        );
        return { ok: true, objective: toObjective(rows[0]!) };
      });
    },

    async listObjectives(ctx, competencyId): Promise<ObjectiveRecord[]> {
      return withTenant(ctx, async (db) => {
        const rows = competencyId
          ? await db.$queryRawUnsafe<ObjectiveRow[]>(
              `SELECT id, tenant_id, competency_id, code, statement
                 FROM learning_objective WHERE competency_id = $1::uuid
                ORDER BY code, statement`,
              competencyId,
            )
          : await db.$queryRawUnsafe<ObjectiveRow[]>(
              `SELECT id, tenant_id, competency_id, code, statement
                 FROM learning_objective ORDER BY code, statement`,
            );
        return rows.map(toObjective);
      });
    },

    async alignObjective(
      ctx,
      objectiveId,
      input: NewAlignmentInput,
    ): Promise<AlignResult> {
      return withTenant<AlignResult>(ctx, async (db) => {
        const obj = await db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM learning_objective WHERE id = $1::uuid LIMIT 1`,
          objectiveId,
        );
        if (obj.length === 0) return { ok: false, reason: "unknown_objective" };
        const rows = await db.$queryRawUnsafe<AlignmentRow[]>(
          `INSERT INTO objective_alignment
             (tenant_id, objective_id, target_type, target_id)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
           RETURNING id, tenant_id, objective_id, target_type, target_id`,
          ctx.tenantId,
          objectiveId,
          input.targetType,
          input.targetId,
        );
        return { ok: true, alignment: toAlignment(rows[0]!) };
      });
    },

    async listAlignmentsForObjective(
      ctx,
      objectiveId,
    ): Promise<AlignmentRecord[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<AlignmentRow[]>(
          `SELECT id, tenant_id, objective_id, target_type, target_id
             FROM objective_alignment WHERE objective_id = $1::uuid
            ORDER BY target_type`,
          objectiveId,
        );
        return rows.map(toAlignment);
      });
    },

    async listObjectivesForTarget(
      ctx,
      targetType,
      targetId,
    ): Promise<ObjectiveRecord[]> {
      return withTenant(ctx, async (db) => {
        const rows = await db.$queryRawUnsafe<ObjectiveRow[]>(
          `SELECT o.id, o.tenant_id, o.competency_id, o.code, o.statement
             FROM learning_objective o
             JOIN objective_alignment a ON a.objective_id = o.id
            WHERE a.target_type = $1 AND a.target_id = $2::uuid
            ORDER BY o.code, o.statement`,
          targetType,
          targetId,
        );
        return rows.map(toObjective);
      });
    },
  };
}
