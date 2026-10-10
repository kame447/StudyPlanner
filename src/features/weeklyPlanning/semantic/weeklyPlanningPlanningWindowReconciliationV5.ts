import { reconcileWeeklyPlanningWindowDependentsV5 } from './weeklyPlanningPlanningWindowDependentsV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from './weeklyPlanningSemanticCanonicalizerV5';

/** Old writers left active questions on superseded windows. Repair on the next
 * accepted write, following the same replacement policy along retained history.
 * Reading/checkpoint validation must continue to admit the original bytes. */
export function reconcileWeeklyPlanningHistoricalWindowQuestionsV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const result = params.canonicalization;
  if (result.status !== 'applied' || !result.diff) return result;
  let graph = result.graph;
  const removed = [...result.diff.removed];
  const visited = new Set<string>();
  const reject = (errors: string[]): WeeklyPlanningSemanticCanonicalizationResultV5 => ({
    ...result, status: 'rejected', graph: params.originalGraph, diff: null, errors,
  });
  while (true) {
    const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    const dangling = graph.uncertainties.find(need => active.has(need.id) && need.targetFactId
      && !active.has(need.targetFactId) && graph.planningWindows.some(window => window.id === need.targetFactId));
    if (!dangling?.targetFactId) break;
    const targetFactId = dangling.targetFactId;
    // Distinct historical branches can converge on the same successor. Only
    // revisiting the same question/target pair proves a cycle.
    const reference = JSON.stringify([dangling.id, targetFactId]);
    if (visited.has(reference)) return reject([`window-reconciliation-cycle:${targetFactId}`]);
    visited.add(reference);
    const lifecycle = graph.factLifecycles.find(entry => entry.factId === targetFactId);
    if (lifecycle?.status !== 'superseded' || !lifecycle.supersededByFactId) {
      return reject([`window-reconciliation-replacement-required:${targetFactId}`]);
    }
    const reconciled = reconcileWeeklyPlanningWindowDependentsV5({
      graph, targetFactId, replacementFactId: lifecycle.supersededByFactId,
      terminalRevision: graph.revision + 1,
    });
    if (reconciled.errors.length) return reject(reconciled.errors);
    graph = { ...reconciled.graph, revision: Math.max(graph.revision + 1, reconciled.graph.revision) };
    removed.push(...reconciled.removed);
  }
  return graph === result.graph ? result : {
    ...result, graph, diff: { ...result.diff, toRevision: graph.revision, removed },
  };
}
