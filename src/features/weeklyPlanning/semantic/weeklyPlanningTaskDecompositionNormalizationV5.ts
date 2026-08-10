export const WEEKLY_PLANNING_TASK_DECOMPOSITION_NORMALIZATION_VERSION_V5 =
  'weekly-planning-task-decomposition-normalization-v5' as const;

export interface WeeklyPlanningTaskDecompositionNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function collectLocalIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectLocalIds(entry, ids));
    return ids;
  }
  if (!isRecord(value)) return ids;
  const localId = nonEmptyString(value.localId);
  if (localId) ids.add(localId);
  Object.values(value).forEach((entry) => collectLocalIds(entry, ids));
  return ids;
}

function uniqueDerivedLocalId(taskLocalId: string, occupied: Set<string>): string {
  const base = `derived-work-breakdown-${taskLocalId}`;
  if (!occupied.has(base)) return base;
  let index = 2;
  while (occupied.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function normalizeTaskDecompositionUncertaintiesV5(
  rawResponse: string,
): WeeklyPlanningTaskDecompositionNormalizationResultV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.uncertainties)) {
    return { rawResponse, repairs: [] };
  }

  const occupied = collectLocalIds(parsed);
  const uncertainties = [...parsed.uncertainties];
  const repairs: string[] = [];

  parsed.tasks.forEach((taskValue, taskIndex) => {
    if (!isRecord(taskValue) || taskValue.decompositionStatus !== 'needs_breakdown') return;
    const taskLocalId = nonEmptyString(taskValue.localId);
    const sourceText = nonEmptyString(taskValue.sourceText);
    if (!taskLocalId || !sourceText) return;

    const alreadyPresent = uncertainties.some((entry) =>
      isRecord(entry)
      && entry.field === 'work_breakdown'
      && entry.targetLocalId === taskLocalId);
    if (alreadyPresent) return;

    const localId = uniqueDerivedLocalId(taskLocalId, occupied);
    occupied.add(localId);
    uncertainties.push({
      localId,
      targetLocalId: taskLocalId,
      field: 'work_breakdown',
      reason: 'task constituents are not yet identified for planning',
      sourceText,
    });
    repairs.push(`task-decomposition-uncertainty-derived:${taskIndex}:${taskLocalId}`);
  });

  if (repairs.length === 0) return { rawResponse, repairs: [] };
  parsed.uncertainties = uncertainties;
  return { rawResponse: JSON.stringify(parsed), repairs };
}
