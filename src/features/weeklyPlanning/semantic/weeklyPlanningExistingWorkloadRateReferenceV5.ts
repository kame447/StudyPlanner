import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const records = (value: unknown) => Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];

/** Resolve a validated machine-id rate scope, without importing an old quantity as new language. */
export function projectWeeklyPlanningExistingWorkloadRateReferenceV5(params: {
  rawResponse: string; graph?: WeeklyPlanningFactGraphV5;
}): { rawResponse: string; repairs: string[] } {
  if (!params.graph) return { rawResponse: params.rawResponse, repairs: [] };
  let document: Record<string, unknown> | null;
  try { document = record(JSON.parse(params.rawResponse)); } catch { return { rawResponse: params.rawResponse, repairs: [] }; }
  if (!document) return { rawResponse: params.rawResponse, repairs: [] };
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const repairs: string[] = [];
  for (const task of records(document.tasks)) {
    if (!graph.tasks.some((fact) => fact.id === task.existingPublicId) || typeof task.localId !== 'string') continue;
    const components = records(record(task.study)?.components);
    const containers = [task, ...components];
    const workloads = containers.flatMap((container) => records(container.workloads));
    for (const estimate of records(task.effortEstimates)) {
      if (estimate.kind !== 'duration_per_unit') continue;
      const target = graph.workloads.find((fact) => fact.id === estimate.targetLocalId
        && fact.taskId === task.existingPublicId && fact.unitCode === estimate.unitCode);
      if (!target) continue;
      // A task-bound rate is equivalent only with one compatible accepted
      // scope, and no new same-unit scope in this delta. Never broaden a rate.
      if (graph.workloads.filter((fact) => fact.taskId === target.taskId && fact.unitCode === target.unitCode).length !== 1
        || workloads.some((fact) => fact.localId !== target.id && fact.unitCode === target.unitCode)) continue;
      const replay = workloads.find((fact) => fact.localId === target.id);
      const replayContainer = containers.find((container) => records(container.workloads).includes(replay!));
      if (replay && (replayContainer === task ? target.componentId !== null
        : replayContainer?.existingPublicId !== target.componentId)) continue;
      const identical = (fact: Record<string, unknown>) => ['quantityRole', 'amount', 'unitCode', 'unitLabel', 'rangeStart', 'rangeEnd', 'perOccurrence', 'periodExpression']
        .every((key) => fact[key] === target[key as keyof typeof target]);
      if (replay && !identical(replay)) continue;
      for (const container of containers) if (Array.isArray(container.workloads)) {
        container.workloads = container.workloads.filter((fact) => fact !== replay);
      }
      estimate.targetLocalId = task.localId;
      repairs.push(`active-workload-rate-reference-projected:${estimate.localId}:${target.id}`);
    }
  }
  return { rawResponse: repairs.length ? JSON.stringify(document) : params.rawResponse, repairs };
}
