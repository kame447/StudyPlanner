import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { workloadQuantityPhraseV5 } from '../semantic/weeklyPlanningWorkloadQuantityLabelV5';

/**
 * Typed facts about work that did not fit (Issue #488 exam-student B3). The scheduler places each
 * work item whole, so this is "what did not fit in this attempt" plus the plan's total requested
 * minutes: it is never a shortfall against free time (the scheduler does not expose that).
 */
export const CAPACITY_SHORTFALL_ITEM_LIMIT = 5;

export interface WeeklyPlanningCapacityShortfallItem {
  label: string;
  /** `120問`, built from the typed unit code (empty when no trustworthy unit text exists). */
  quantity: string;
  minutes: number;
}

export interface WeeklyPlanningCapacityShortfall {
  requiredMinutes: number;
  unmetMinutes: number;
  unmetWork: WeeklyPlanningCapacityShortfallItem[];
  /** Tasks with work that did not fit, beyond the listed ones. */
  moreCount: number;
}

export function capacityShortfallFromPreview(params: {
  preview: { status: string; unscheduledWorkItemIds: readonly string[] } | undefined;
  schedulerInput: GenericSchedulerInput | undefined;
  /** Task titles by task fact id (a work item label carries its own range, e.g. 「物理 10問（91〜100問）」). */
  taskTitleById?: ReadonlyMap<string, string>;
}): WeeklyPlanningCapacityShortfall | null {
  const { preview, schedulerInput } = params;
  if (!preview || preview.status !== 'insufficient_capacity' || !schedulerInput) return null;
  const items = new Map(schedulerInput.movableWorkItems.map((item) => [item.id, item]));
  const unmet = preview.unscheduledWorkItemIds.flatMap((id) => {
    const item = items.get(id);
    return item ? [item] : [];
  });
  if (unmet.length === 0) return null;
  const minutes = (value: number | null) => Math.max(0, Math.round(value ?? 0));
  // One entry per task: its unmet items summed (the amount only when every item shares one typed unit).
  const byTask = new Map<string, typeof unmet>();
  for (const item of unmet) byTask.set(item.taskId, [...(byTask.get(item.taskId) ?? []), item]);
  const entries = [...byTask.entries()].map(([taskId, taskItems]) => {
    const first = taskItems[0];
    const sameUnit = taskItems.every((item) =>
      item.quantity.unitCode === first.quantity.unitCode && item.quantity.unitLabel === first.quantity.unitLabel);
    return {
      label: (params.taskTitleById?.get(taskId) ?? first.label).trim(),
      quantity: sameUnit
        ? workloadQuantityPhraseV5(
            taskItems.reduce((sum, item) => sum + item.quantity.amount, 0),
            first.quantity.unitCode,
            first.quantity.unitLabel,
          )
        : '',
      minutes: taskItems.reduce((sum, item) => sum + minutes(item.estimatedMinutes), 0),
    };
  });
  return {
    requiredMinutes: schedulerInput.movableWorkItems.reduce((sum, item) => sum + minutes(item.estimatedMinutes), 0),
    unmetMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    unmetWork: entries.slice(0, CAPACITY_SHORTFALL_ITEM_LIMIT),
    moreCount: Math.max(0, entries.length - CAPACITY_SHORTFALL_ITEM_LIMIT),
  };
}
