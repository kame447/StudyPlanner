export const WEEKLY_PLANNING_RECURRENCE_TARGET_NORMALIZATION_VERSION_V5 =
  'weekly-planning-recurrence-target-normalization-v5' as const;

export interface WeeklyPlanningRecurrenceTargetNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A recurrence belongs to a schedulable task or component, while a workload
 * describes the repeated amount. When the provider points a recurrence at the
 * exact localId of one nested workload, move the reference to that workload's
 * unambiguous containing task/component. No text or label matching is used.
 */
export function normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5(
  rawResponse: string,
): WeeklyPlanningRecurrenceTargetNormalizationResultV5 {
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
  parsed.tasks.forEach((task) => {
    if (!isRecord(task) || typeof task.localId !== 'string') return;
    const owners = new Map<string, string | null>();
    const register = (workloads: unknown, ownerLocalId: string): void => {
      if (!Array.isArray(workloads)) return;
      workloads.forEach((workload) => {
        if (!isRecord(workload) || typeof workload.localId !== 'string') return;
        owners.set(
          workload.localId,
          owners.has(workload.localId) ? null : ownerLocalId,
        );
      });
    };
    register(task.workloads, task.localId);
    const components = isRecord(task.study) && Array.isArray(task.study.components)
      ? task.study.components
      : [];
    components.forEach((component) => {
      if (!isRecord(component) || typeof component.localId !== 'string') return;
      register(component.workloads, component.localId);
    });
    if (!Array.isArray(task.recurrence)) return;
    task.recurrence.forEach((recurrence) => {
      if (!isRecord(recurrence) || typeof recurrence.targetLocalId !== 'string') return;
      const ownerLocalId = owners.get(recurrence.targetLocalId);
      if (!ownerLocalId) return;
      const workloadLocalId = recurrence.targetLocalId;
      recurrence.targetLocalId = ownerLocalId;
      changed = true;
      repairs.push(
        `recurrence-workload-target-normalized:${task.localId}:${String(recurrence.localId ?? 'unknown-recurrence')}:${workloadLocalId}:${ownerLocalId}`,
      );
    });
  });

  return changed
    ? { rawResponse: JSON.stringify(parsed), repairs }
    : { rawResponse, repairs: [] };
}
