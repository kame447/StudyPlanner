import { weeklyPlanningActiveFactReferencesV5 } from './weeklyPlanningActiveFactReferenceInvariantV5';
import type { PlanningWindowFactV5, WeeklyPlanningFactDiffEntryV5, WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

/** Only canonical values prove a change. Named periods are free text; neither
 * their wording nor cross-kind calendar equivalence grants that authority. */
export function compareWeeklyPlanningWindowPayloadsV5(
  target: PlanningWindowFactV5,
  replacement: PlanningWindowFactV5,
): 'identical' | 'changed' | 'unknown' {
  if (target.kind === replacement.kind && target.value === replacement.value
    && target.start === replacement.start && target.end === replacement.end) return 'identical';
  if (target.kind !== replacement.kind || target.kind === 'named_period') return 'unknown';
  return 'changed';
}

/** Window meaning has an explicit carry rule. A changed date invalidates the old
 * question; equal typed values preserve it. No prose or uncertainty field is read. */
export function reconcileWeeklyPlanningWindowDependentsV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  targetFactId: string;
  replacementFactId: string;
  terminalRevision: number;
}): { graph: WeeklyPlanningFactGraphV5; removed: WeeklyPlanningFactDiffEntryV5[]; errors: string[] } {
  const { graph, targetFactId, replacementFactId, terminalRevision } = params;
  const target = graph.planningWindows.find(fact => fact.id === targetFactId);
  const replacement = graph.planningWindows.find(fact => fact.id === replacementFactId);
  if (!target || !replacement) return { graph, removed: [], errors: ['window-replacement-kind-mismatch'] };
  const dependents = weeklyPlanningActiveFactReferencesV5(graph).filter(ref => ref.targetFactId === targetFactId);
  const uncertainties = new Set(graph.uncertainties.map(fact => fact.id));
  const unsupported = dependents.filter(ref => !uncertainties.has(ref.factId));
  if (unsupported.length) return { graph, removed: [], errors: unsupported.map(ref => `window-dependent-policy-required:${ref.factId}`) };
  const ids = new Set(dependents.map(ref => ref.factId));
  if (!ids.size) return { graph, removed: [], errors: [] };
  if (compareWeeklyPlanningWindowPayloadsV5(target, replacement) !== 'changed') {
    return { graph: { ...graph, uncertainties: graph.uncertainties.map(fact => ids.has(fact.id) ? { ...fact, targetFactId: replacementFactId } : fact) }, removed: [], errors: [] };
  }
  // A current-turn uncertainty can target the old window; retirement must still
  // follow its creation revision, just like every other lifecycle operation.
  const revision = Math.max(terminalRevision, ...graph.uncertainties.filter(fact => ids.has(fact.id)).map(fact => fact.createdRevision + 1));
  return {
    graph: { ...graph, revision: Math.max(graph.revision, revision), factLifecycles: graph.factLifecycles.map(entry => ids.has(entry.factId)
      ? { ...entry, status: 'removed', terminalRevision: revision, supersededByFactId: null } : entry) },
    removed: [...ids].map(id => ({ kind: 'uncertainty', id })), errors: [],
  };
}
