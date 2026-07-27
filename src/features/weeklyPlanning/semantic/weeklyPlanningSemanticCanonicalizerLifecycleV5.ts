import {
  createActiveLifecycleEntriesV5,
} from './weeklyPlanningFactLifecycleV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
  type WeeklyPlanningSemanticCanonicalizationContextV5,
  type WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function supersedePreviousPlanningWindows(params: {
  previousGraph: WeeklyPlanningFactGraphV5;
  result: WeeklyPlanningSemanticCanonicalizationResultV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  if (params.result.status !== 'applied' || !params.result.diff) return params.result;

  const replacementWindowIds = params.result.diff.added
    .filter((entry) => entry.kind === 'planning_window')
    .map((entry) => entry.id);
  if (replacementWindowIds.length !== 1) return params.result;

  const replacementFactId = replacementWindowIds[0];
  const previouslyActiveFactIds = new Set(
    params.previousGraph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  const superseded = params.previousGraph.planningWindows
    .filter((window) => previouslyActiveFactIds.has(window.id))
    .map((window) => ({ kind: 'planning_window' as const, id: window.id }));
  if (superseded.length === 0) return params.result;

  const supersededIds = new Set(superseded.map((entry) => entry.id));
  const terminalRevision = params.result.diff.toRevision;
  return {
    ...params.result,
    graph: {
      ...params.result.graph,
      factLifecycles: params.result.graph.factLifecycles.map((entry) =>
        supersededIds.has(entry.factId) && entry.status === 'active'
          ? {
              ...entry,
              status: 'superseded' as const,
              terminalRevision,
              supersededByFactId: replacementFactId,
            }
          : entry),
    },
    diff: {
      ...params.result.diff,
      superseded: [...params.result.diff.superseded, ...superseded],
    },
  };
}

export function canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5(params: {
  graph?: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  context: WeeklyPlanningSemanticCanonicalizationContextV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const previousGraph = params.graph;
  const result = canonicalizeWeeklyPlanningSemanticDocumentV5(params);
  if (result.status !== 'applied' || !result.diff) return result;

  const withLifecycle: WeeklyPlanningSemanticCanonicalizationResultV5 = {
    ...result,
    graph: {
      ...result.graph,
      factLifecycles: [
        ...result.graph.factLifecycles,
        ...createActiveLifecycleEntriesV5({
          added: result.diff.added,
          revision: result.diff.toRevision,
        }),
      ],
    },
  };
  return previousGraph
    ? supersedePreviousPlanningWindows({ previousGraph, result: withLifecycle })
    : withLifecycle;
}
