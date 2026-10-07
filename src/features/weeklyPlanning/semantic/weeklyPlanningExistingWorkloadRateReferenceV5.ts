import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from './weeklyPlanningSemanticCanonicalizerV5';

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const records = (value: unknown) => Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
const isDurationEstimate = (estimate: Record<string, unknown>) =>
  estimate.kind === 'session_duration' || estimate.kind === 'total_duration';
const bindingSignature = (task: Record<string, unknown>, estimate: Record<string, unknown>, workloadId: string) =>
  `${isDurationEstimate(estimate) ? 'active-workload-duration-reference-projected' : 'active-workload-rate-reference-projected'}:${JSON.stringify([task.localId, task.existingPublicId, estimate.localId,
    estimate.kind, estimate.minutes, estimate.unitCode, estimate.precision, estimate.sourceText, workloadId])}`;

/** Bridge an exact accepted-workload ID for effort without importing old quantity as new language. */
export function projectWeeklyPlanningExistingWorkloadRateReferenceV5(params: {
  rawResponse: string; graph?: WeeklyPlanningFactGraphV5;
}): { rawResponse: string; repairs: string[] } {
  if (!params.graph) return { rawResponse: params.rawResponse, repairs: [] };
  let document: Record<string, unknown> | null;
  try { document = record(JSON.parse(params.rawResponse)); } catch { return { rawResponse: params.rawResponse, repairs: [] }; }
  if (!document) return { rawResponse: params.rawResponse, repairs: [] };
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const repairs: string[] = [];
  const allEstimates = records(document.tasks).flatMap(task => records(task.effortEstimates));
  for (const task of records(document.tasks)) {
    if (!graph.tasks.some((fact) => fact.id === task.existingPublicId) || typeof task.localId !== 'string') continue;
    const components = records(record(task.study)?.components);
    const containers = [task, ...components];
    const workloads = containers.flatMap((container) => records(container.workloads));
    for (const estimate of records(task.effortEstimates)) {
      const duration = isDurationEstimate(estimate);
      if (estimate.kind !== 'duration_per_unit' && !duration) continue;
      const target = graph.workloads.find((fact) => fact.id === estimate.targetLocalId
        && fact.taskId === task.existingPublicId && (duration || fact.unitCode === estimate.unitCode));
      if (!target) continue;
      if (duration) {
        // One exact citation owns the scope. Another estimate or new quantity must
        // go through normal semantic validation; never guess which one was meant.
        if (allEstimates.filter(fact => fact.targetLocalId === target.id).length !== 1
          || workloads.some(fact => fact.localId !== target.id)
          || workloads.filter(fact => fact.localId === target.id).length > 1) continue;
      } else {
        // Preserve the existing rate projection's single compatible-unit boundary.
        if (graph.workloads.filter(fact => fact.taskId === target.taskId && fact.unitCode === target.unitCode).length !== 1
          || workloads.some(fact => fact.localId !== target.id && fact.unitCode === target.unitCode)) continue;
      }
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
      repairs.push(bindingSignature(task, estimate, target.id));
      estimate.targetLocalId = task.localId;
    }
  }
  return { rawResponse: repairs.length ? JSON.stringify(document) : params.rawResponse, repairs };
}

/** The task-local bridge is representation only: retain the validated workload's scope. */
export function bindWeeklyPlanningExistingWorkloadRatesV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5; document: WeeklyPlanningSemanticDocumentV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5; algorithmicRepairs?: readonly string[];
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const base = params.canonicalization;
  if (base.status !== 'applied' || !base.diff || !params.algorithmicRepairs?.length) return base;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.originalGraph);
  const targets = new Map<string, string>();
  for (const task of params.document.tasks) for (const estimate of task.effortEstimates) {
    const duration = isDurationEstimate({ ...estimate });
    if ((estimate.kind !== 'duration_per_unit' && !duration) || estimate.targetLocalId !== task.localId) continue;
    const matches = active.workloads.filter((workload) => workload.taskId === task.existingPublicId
      && (duration || workload.unitCode === estimate.unitCode)
      && params.algorithmicRepairs!.includes(bindingSignature({ ...task }, { ...estimate }, workload.id)));
    const estimateId = base.localToFactId[estimate.localId];
    if (matches.length !== 1 || !base.diff.added.some((entry) => entry.kind === 'effort_estimate' && entry.id === estimateId)) continue;
    targets.set(estimateId, matches[0].id);
  }
  if (!targets.size) return base;
  return { ...base, graph: { ...base.graph, effortEstimates: base.graph.effortEstimates.map((fact) =>
    targets.has(fact.id) ? { ...fact, targetFactId: targets.get(fact.id)! } : fact) } };
}
