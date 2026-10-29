// Read-only shadow comparison: the same saved V5 graph through the current V5
// work-item compiler and through the VNext adapter + projector. Nothing here
// writes state, preview, trace or storage.
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { compileGenericPlanningWorkItems } from '../../semantic/weeklyPlanningGenericWorkItems';
import { projectWeeklyPlanningStatedTimeBudgetGraphV5 } from '../../semantic/weeklyPlanningStatedTimeBudgetProjectionV5';
import type { VNextQuestionCode } from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';
import {
  adaptWeeklyPlanningV5GraphToVNext,
  type WeeklyPlanningVNextAdapterNote,
} from './weeklyPlanningVNextV5Adapter';

export type WeeklyPlanningShadowDifference =
  | 'same'
  | 'minutes_differ'
  | 'work_set_differs'
  | 'vnext_asks_v5_ready'
  | 'v5_asks_vnext_ready'
  | 'both_ask'
  | 'only_v5_schedules'
  | 'only_vnext_schedules';

export interface WeeklyPlanningShadowOwnerComparison {
  taskId: string;
  componentId: string | null;
  difference: WeeklyPlanningShadowDifference;
  v5: { blockingIssueCodes: string[]; amounts: number[]; baseMinutes: number | null };
  vnext: { questionCode: VNextQuestionCode | null; amounts: number[]; minutes: number | null };
}

export interface WeeklyPlanningShadowComparison {
  graphRevision: number;
  owners: WeeklyPlanningShadowOwnerComparison[];
  adapterNotes: WeeklyPlanningVNextAdapterNote[];
}

function ownerKey(taskId: string, componentId: string | null): string {
  return `${taskId}/${componentId ?? ''}`;
}

function classify(owner: Omit<WeeklyPlanningShadowOwnerComparison, 'difference'>): WeeklyPlanningShadowDifference {
  const v5Asks = owner.v5.blockingIssueCodes.length > 0;
  const vnextAsks = owner.vnext.questionCode !== null;
  if (v5Asks && vnextAsks) return 'both_ask';
  if (v5Asks) return owner.vnext.amounts.length > 0 ? 'v5_asks_vnext_ready' : 'both_ask';
  if (vnextAsks) return owner.v5.amounts.length > 0 ? 'vnext_asks_v5_ready' : 'both_ask';
  if (owner.v5.amounts.length === 0) return owner.vnext.amounts.length === 0 ? 'same' : 'only_vnext_schedules';
  if (owner.vnext.amounts.length === 0) return 'only_v5_schedules';
  const sorted = (values: number[]) => [...values].sort((a, b) => a - b).join(',');
  if (sorted(owner.v5.amounts) !== sorted(owner.vnext.amounts)) return 'work_set_differs';
  return Math.abs((owner.v5.baseMinutes ?? 0) - (owner.vnext.minutes ?? 0)) < 1e-9 ? 'same' : 'minutes_differ';
}

export function compareWeeklyPlanningV5AndVNext(graph: WeeklyPlanningFactGraphV5): WeeklyPlanningShadowComparison {
  const v5View = projectWeeklyPlanningStatedTimeBudgetGraphV5(createWeeklyPlanningActiveSchedulerGraphViewV5(graph));
  const v5 = compileGenericPlanningWorkItems(v5View);
  const workloadOwner = new Map(v5View.workloads.map((workload) => [workload.id, ownerKey(workload.taskId, workload.componentId)]));
  const { state, notes } = adaptWeeklyPlanningV5GraphToVNext(graph);
  const vnext = projectWeeklyPlanningVNext(state);

  const owners = new Map<string, Omit<WeeklyPlanningShadowOwnerComparison, 'difference'>>();
  const entry = (taskId: string, componentId: string | null) => {
    const key = ownerKey(taskId, componentId);
    if (!owners.has(key)) {
      owners.set(key, {
        taskId,
        componentId,
        v5: { blockingIssueCodes: [], amounts: [], baseMinutes: null },
        vnext: { questionCode: null, amounts: [], minutes: null },
      });
    }
    return owners.get(key)!;
  };
  for (const item of v5.items) {
    const owner = entry(item.taskId, item.componentId);
    owner.v5.amounts.push(item.quantity.amount);
    if (item.baseEstimatedMinutes !== null && item.baseEstimatedMinutes !== undefined) {
      owner.v5.baseMinutes = (owner.v5.baseMinutes ?? 0) + item.baseEstimatedMinutes;
    }
  }
  for (const issue of v5.issues) {
    if (!issue.blocking) continue;
    const key = workloadOwner.get(issue.workloadFactId);
    const workload = v5View.workloads.find((candidate) => candidate.id === issue.workloadFactId);
    if (!key || !workload) continue;
    entry(workload.taskId, workload.componentId).v5.blockingIssueCodes.push(issue.code);
  }
  for (const owner of vnext.owners) {
    const comparison = entry(owner.taskId, owner.componentId);
    comparison.vnext.questionCode = owner.question?.code ?? null;
    comparison.vnext.amounts = owner.work.map((item) => item.amount);
    comparison.vnext.minutes = owner.work.length > 0
      ? owner.work.reduce((sum, item) => sum + (item.minutes ?? 0), 0)
      : null;
  }
  return {
    graphRevision: graph.revision,
    owners: [...owners.values()].map((owner) => ({ ...owner, difference: classify(owner) })),
    adapterNotes: notes,
  };
}
