import type {
  RubricDetail,
  ScoreRubricResult,
  ScoreSelection,
} from "./store.js";

/**
 * Pure rubric tally: pick one level per criterion, sum the points. `max` is the
 * sum of each criterion's highest level, so callers can map `total/max` onto a
 * gradebook line item. Rejects selections that reference a criterion not in the
 * rubric, a level not in the criterion, or the same criterion twice.
 */
export function computeRubricScore(
  detail: RubricDetail,
  selections: ScoreSelection[],
): ScoreRubricResult {
  const seen = new Set<string>();
  const lines = [];
  for (const sel of selections) {
    const criterion = detail.criteria.find((c) => c.id === sel.criterionId);
    if (!criterion) {
      return {
        ok: false,
        reason: "invalid_selection",
        message: `Criterion ${sel.criterionId} is not part of this rubric.`,
      };
    }
    if (seen.has(criterion.id)) {
      return {
        ok: false,
        reason: "invalid_selection",
        message: `Criterion ${criterion.id} selected more than once.`,
      };
    }
    const level = criterion.levels.find((l) => l.id === sel.levelId);
    if (!level) {
      return {
        ok: false,
        reason: "invalid_selection",
        message: `Level ${sel.levelId} is not part of criterion ${criterion.id}.`,
      };
    }
    seen.add(criterion.id);
    lines.push({
      criterionId: criterion.id,
      levelId: level.id,
      points: level.points,
    });
  }

  const total = lines.reduce((sum, l) => sum + l.points, 0);
  const max = detail.criteria.reduce((sum, c) => {
    const best = c.levels.reduce((m, l) => Math.max(m, l.points), 0);
    return sum + best;
  }, 0);

  return {
    ok: true,
    score: { rubricId: detail.id, total, max, lines },
  };
}
