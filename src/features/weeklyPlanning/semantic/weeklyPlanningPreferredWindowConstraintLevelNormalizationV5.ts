export interface WeeklyPlanningPreferredWindowConstraintLevelNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * preferred_window already carries soft-preference meaning. A hard level is a
 * contradictory wire representation, not a distinct supported semantic state.
 * Normalize only that exact typed contradiction; never infer preference from text.
 */
export function normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(
  rawResponse: string,
): WeeklyPlanningPreferredWindowConstraintLevelNormalizationResultV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    return { rawResponse, repairs: [] };
  }

  const repairs: string[] = [];
  let changed = false;
  parsed.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) return;
    task.temporalConstraints.forEach((constraint, constraintIndex) => {
      if (
        !isRecord(constraint)
        || constraint.kind !== 'preferred_window'
        || constraint.constraintLevel !== 'hard'
      ) {
        return;
      }
      constraint.constraintLevel = 'soft';
      changed = true;
      repairs.push(
        `preferred-window-constraint-level-canonicalized:${taskIndex}:${constraintIndex}:soft`,
      );
    });
  });

  return changed
    ? { rawResponse: JSON.stringify(parsed), repairs }
    : { rawResponse, repairs: [] };
}
