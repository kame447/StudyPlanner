import { filterActiveWeeklyPlanningFactsV5 } from './weeklyPlanningFactLifecycleV5';
import { isUserUtteranceSourcedV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

/**
 * A bound workload correction carries its accepted per-unit rate through the
 * correction transaction. A provider may echo that exact old rate as context;
 * remove the echo from the delta rather than treating its old citation as new
 * evidence. Changed, unbound, supplemental and inactive estimates still pass
 * through the ordinary provenance gate. No graph fact is changed here.
 */
export function projectWeeklyPlanningCorrectionContextV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  committedGraph?: WeeklyPlanningFactGraphV5;
}): { document: WeeklyPlanningSemanticDocumentV5; repairs: string[] } {
  const { document, committedGraph: graph } = params;
  if (!graph || document.corrections.length === 0) return { document, repairs: [] };

  const activeTasks = filterActiveWeeklyPlanningFactsV5(graph, graph.tasks);
  const activeComponents = filterActiveWeeklyPlanningFactsV5(graph, graph.components);
  const activeWorkloads = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads);
  const activeEstimates = filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates);
  const referencedIds = new Set([
    ...document.corrections.flatMap(correction => [correction.target.localId, correction.replacementLocalId]),
    ...document.decisions.map(decision => decision.target.localId),
    ...document.uncertainties.map(uncertainty => uncertainty.targetLocalId),
  ]);
  const repairs: string[] = [];
  const tasks = document.tasks.map(task => {
    if (!task.existingPublicId || !activeTasks.some(fact => fact.id === task.existingPublicId)) return task;
    const placements = [
      ...task.workloads.map(workload => ({ workload, componentId: null as string | null })),
      ...(task.study?.components ?? []).flatMap(component => {
        const bound = activeComponents.find(fact => fact.id === component.existingPublicId
          && fact.taskId === task.existingPublicId);
        return bound ? component.workloads.map(workload => ({ workload, componentId: bound.id })) : [];
      }),
    ];
    const effortEstimates = task.effortEstimates.filter(estimate => {
      if (estimate.kind !== 'duration_per_unit' || referencedIds.has(estimate.localId)) return true;
      const replacement = placements.find(entry => entry.workload.localId === estimate.targetLocalId);
      if (!replacement) return true;
      const corrections = document.corrections.filter(correction =>
        correction.target.kind === 'workload'
        && correction.target.publicId !== null
        && correction.target.localId === null
        && (correction.operation === 'replace' || correction.operation === 'modify')
        && correction.replacementLocalId === replacement.workload.localId);
      if (corrections.length !== 1) return true;
      const target = activeWorkloads.find(fact => fact.id === corrections[0].target.publicId
        && fact.taskId === task.existingPublicId && fact.componentId === replacement.componentId);
      if (!target || target.unitCode !== replacement.workload.unitCode
        || target.quantityRole !== replacement.workload.quantityRole
        || target.perOccurrence !== replacement.workload.perOccurrence
        || target.periodExpression !== replacement.workload.periodExpression) return true;

      const matches = activeEstimates.filter(fact => fact.taskId === target.taskId
        && fact.targetFactId === target.id && fact.kind === estimate.kind
        && fact.minutes === estimate.minutes && fact.unitCode === estimate.unitCode
        && fact.precision === estimate.precision
        && fact.source.sourceText === estimate.sourceText
        && isUserUtteranceSourcedV5(fact.source));
      if (matches.length !== 1) return true;
      repairs.push(`committed-correction-rate-context-omitted:${estimate.localId}:${matches[0].id}`);
      return false;
    });
    return effortEstimates.length === task.effortEstimates.length ? task : { ...task, effortEstimates };
  });
  return { document: repairs.length === 0 ? document : { ...document, tasks }, repairs };
}
