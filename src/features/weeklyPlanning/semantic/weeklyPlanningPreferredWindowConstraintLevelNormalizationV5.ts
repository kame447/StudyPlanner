export interface WeeklyPlanningPreferredWindowConstraintLevelNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Preserve explicit hard clock bounds using the existing one-sided contract.
 * Named-period-only preferences retain their existing soft canonicalization.
 * This consumes typed fields only, never utterance text.
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
  const localIds = new Set<string>();
  const pending: unknown[] = [parsed];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) pending.push(...value);
    else if (isRecord(value)) {
      if (typeof value.localId === 'string') localIds.add(value.localId);
      pending.push(...Object.values(value));
    }
  }
  const uniqueEndId = (localId: string): string => {
    const base = `${localId}__latest_end`;
    let id = base;
    for (let suffix = 1; localIds.has(id); suffix += 1) id = `${base}_${suffix}`;
    localIds.add(id);
    return id;
  };
  let changed = false;
  parsed.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) return;
    task.temporalConstraints = task.temporalConstraints.flatMap((constraint, constraintIndex) => {
      if (
        !isRecord(constraint)
        || constraint.kind !== 'preferred_window'
        || constraint.constraintLevel !== 'hard'
      ) {
        return [constraint];
      }
      const hasStart = typeof constraint.startTime === 'string' && constraint.startTime.length > 0;
      const hasEnd = typeof constraint.endTime === 'string' && constraint.endTime.length > 0;
      if (constraint.namedTimePeriod === null && (hasStart || hasEnd) && typeof constraint.localId === 'string') {
        const bounds: Record<string, unknown>[] = [];
        if (hasStart) bounds.push({ ...constraint, kind: 'earliest_start', endTime: null });
        if (hasEnd) bounds.push({
          ...constraint, kind: 'latest_end', startTime: null,
          localId: hasStart ? uniqueEndId(constraint.localId) : constraint.localId,
        });
        changed = true;
        repairs.push(`preferred-window-hard-clock-bounds-canonicalized:${taskIndex}:${constraintIndex}`);
        return bounds;
      }
      constraint.constraintLevel = 'soft';
      changed = true;
      repairs.push(
        `preferred-window-constraint-level-canonicalized:${taskIndex}:${constraintIndex}:soft`,
      );
      return [constraint];
    });
  });

  return changed
    ? { rawResponse: JSON.stringify(parsed), repairs }
    : { rawResponse, repairs: [] };
}
