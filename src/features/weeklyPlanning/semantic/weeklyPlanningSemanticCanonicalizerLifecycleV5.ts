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

export function canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5(params: {
  graph?: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  context: WeeklyPlanningSemanticCanonicalizationContextV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const result = canonicalizeWeeklyPlanningSemanticDocumentV5(params);
  if (result.status !== 'applied' || !result.diff) return result;

  const lifecycleEntries = createActiveLifecycleEntriesV5({
    added: result.diff.added,
    revision: result.diff.toRevision,
  });
  return {
    ...result,
    graph: {
      ...result.graph,
      factLifecycles: [
        ...result.graph.factLifecycles,
        ...lifecycleEntries,
      ],
    },
  };
}
