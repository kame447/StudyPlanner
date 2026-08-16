export const WEEKLY_PLANNING_RESOLVED_PROGRESS_NORMALIZATION_V5 =
  'weekly-planning-resolved-progress-normalization-v5' as const;

export interface ResolvedProgressNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameBasis(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return left.unitCode === right.unitCode
    && left.unitLabel === right.unitLabel
    && left.perOccurrence === right.perOccurrence
    && left.periodExpression === right.periodExpression
    && left.rangeStart === right.rangeStart
    && left.rangeEnd === right.rangeEnd;
}

function finiteAmount(value: Record<string, unknown>): number | null {
  return typeof value.amount === 'number' && Number.isFinite(value.amount)
    ? value.amount
    : null;
}

function normalizeWorkloads(
  workloads: unknown[],
  ownerId: string,
  repairs: string[],
): unknown[] {
  return workloads.filter((candidate) => {
    if (!isRecord(candidate) || candidate.quantityRole !== 'declared') return true;
    const declaredAmount = finiteAmount(candidate);
    if (declaredAmount === null) return true;

    const completed = workloads.filter((peer) =>
      isRecord(peer)
      && peer !== candidate
      && peer.quantityRole === 'completed'
      && sameBasis(candidate, peer));
    const remaining = workloads.filter((peer) =>
      isRecord(peer)
      && peer !== candidate
      && peer.quantityRole === 'remaining'
      && sameBasis(candidate, peer));
    if (completed.length !== 1 || remaining.length !== 1) return true;

    const completedAmount = finiteAmount(completed[0] as Record<string, unknown>);
    const remainingAmount = finiteAmount(remaining[0] as Record<string, unknown>);
    if (
      completedAmount === null
      || remainingAmount === null
      || completedAmount + remainingAmount !== declaredAmount
    ) return true;

    const localId = typeof candidate.localId === 'string' ? candidate.localId : 'unknown-workload';
    repairs.push(`resolved-progress-declared-total-removed:${ownerId}:${localId}`);
    return false;
  });
}

function normalizeTask(
  taskValue: unknown,
  taskIndex: number,
  repairs: string[],
): unknown {
  if (!isRecord(taskValue)) return taskValue;
  const taskId = typeof taskValue.localId === 'string' ? taskValue.localId : `task-${taskIndex}`;
  const taskWorkloads = Array.isArray(taskValue.workloads)
    ? normalizeWorkloads(taskValue.workloads, taskId, repairs)
    : taskValue.workloads;

  const study = isRecord(taskValue.study) ? taskValue.study : null;
  const components = Array.isArray(study?.components)
    ? study.components.map((componentValue, componentIndex) => {
        if (!isRecord(componentValue) || !Array.isArray(componentValue.workloads)) {
          return componentValue;
        }
        const componentId = typeof componentValue.localId === 'string'
          ? componentValue.localId
          : `${taskId}:component-${componentIndex}`;
        return {
          ...componentValue,
          workloads: normalizeWorkloads(componentValue.workloads, componentId, repairs),
        };
      })
    : null;

  return {
    ...taskValue,
    ...(Array.isArray(taskValue.workloads) ? { workloads: taskWorkloads } : {}),
    ...(study && components ? { study: { ...study, components } } : {}),
  };
}

export function normalizeResolvedProgressWorkloadsV5(
  rawResponse: string,
): ResolvedProgressNormalizationResultV5 {
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
  const tasks = parsed.tasks.map((task, index) => normalizeTask(task, index, repairs));
  if (repairs.length === 0) return { rawResponse, repairs: [] };

  return {
    rawResponse: JSON.stringify({ ...parsed, tasks }),
    repairs,
  };
}
