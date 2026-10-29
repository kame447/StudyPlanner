// Hands the VNext projection to the existing Stable V5 scheduler and preview
// unchanged: each projected work item becomes one scheduler workload with one
// total estimate of the projected minutes, so the scheduler never re-derives
// amounts or estimates. Read-only; returns null while any question is open.
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
  type WeeklyPlanningActiveSchedulerGraphViewV5,
} from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { EffortEstimateFactV5, WorkloadFactV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningVNextProjection, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';

export function createWeeklyPlanningVNextSchedulerGraphView(
  state: WeeklyPlanningVNextState,
  projection: WeeklyPlanningVNextProjection,
): WeeklyPlanningActiveSchedulerGraphViewV5 | null {
  if (projection.readiness !== 'ready' || projection.graphRevision !== state.graph.revision) return null;
  const resolver = createVNextLineageResolver(state.graph);
  const leaf = (id: string) => resolver.leafOf(id) ?? id;
  const leafOrNull = (id: string | null) => (id === null ? null : leaf(id));
  const base = createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph);
  const sources = new Map([...state.graph.workloads, ...state.graph.tasks].map((fact) => [fact.id, fact.source]));

  const workloads: WorkloadFactV5[] = [];
  const effortEstimates: EffortEstimateFactV5[] = [];
  // Deferred owners are not ready and stay out of the preview (shown as unplaced).
  for (const item of projection.owners.filter((owner) => owner.status === 'ready').flatMap((owner) => owner.work)) {
    const taskTotal = item.estimateBasis === 'task_total' && item.definingFactId === item.taskId;
    const id = taskTotal ? `vnext-task-total:${item.taskId}` : leaf(item.definingFactId);
    const source = sources.get(item.definingFactId)!;
    workloads.push({
      id,
      taskId: leaf(item.taskId),
      componentId: leafOrNull(item.componentId),
      quantityRole: 'target',
      amount: item.amount,
      unitCode: item.unitCode,
      unitLabel: item.unitLabel,
      rangeStart: item.rangeStart,
      rangeEnd: item.rangeEnd,
      perOccurrence: item.perOccurrence,
      periodExpression: item.periodExpression,
      source,
      createdRevision: state.graph.revision,
    });
    if (item.estimateBasis !== 'intrinsic_duration' && item.minutes !== null) {
      effortEstimates.push({
        id: `vnext-estimate:${id}`,
        taskId: leaf(item.taskId),
        targetFactId: id,
        kind: 'total_duration',
        minutes: item.minutes,
        unitCode: null,
        precision: 'exact',
        source,
        createdRevision: state.graph.revision,
      });
    }
  }

  return {
    ...base,
    studyContexts: base.studyContexts.map((fact) => ({ ...fact, taskId: leaf(fact.taskId) })),
    components: base.components.map((fact) => ({
      ...fact, taskId: leaf(fact.taskId), parentComponentId: leafOrNull(fact.parentComponentId),
    })),
    workloads,
    effortEstimates,
    temporalConstraints: base.temporalConstraints.map((fact) => ({
      ...fact, taskId: leaf(fact.taskId), targetFactId: leaf(fact.targetFactId),
    })),
    taskDateRules: base.taskDateRules.map((fact) => ({
      ...fact, taskId: leaf(fact.taskId), targetFactId: leaf(fact.targetFactId),
    })),
    recurrences: base.recurrences.map((fact) => ({
      ...fact, taskId: leaf(fact.taskId), targetFactId: leaf(fact.targetFactId),
    })),
    relations: base.relations.map((fact) => ({ ...fact, fromTaskId: leaf(fact.fromTaskId), toTaskId: leaf(fact.toTaskId) })),
  };
}
