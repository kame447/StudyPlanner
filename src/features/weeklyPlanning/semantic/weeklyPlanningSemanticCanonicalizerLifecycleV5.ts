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

function latestPlanningWindowId(graph: WeeklyPlanningFactGraphV5, activeIds: Set<string>): string | null {
  const orderById = new Map(
    graph.planningWindows.map((window, index) => [window.id, index]),
  );
  const activeWindows = graph.planningWindows.filter((window) => activeIds.has(window.id));
  if (activeWindows.length === 0) return null;

  return activeWindows.reduce((latest, candidate) => {
    if (candidate.createdRevision > latest.createdRevision) return candidate;
    if (candidate.createdRevision < latest.createdRevision) return latest;
    return (orderById.get(candidate.id) ?? -1) > (orderById.get(latest.id) ?? -1)
      ? candidate
      : latest;
  }).id;
}

export function enforceSingleActivePlanningWindowV5(
  result: WeeklyPlanningSemanticCanonicalizationResultV5,
): WeeklyPlanningSemanticCanonicalizationResultV5 {
  if (result.status !== 'applied' || !result.diff) return result;

  const activeIds = new Set(
    result.graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  const activeWindowIds = result.graph.planningWindows
    .filter((window) => activeIds.has(window.id))
    .map((window) => window.id);
  if (activeWindowIds.length <= 1) return result;

  const addedWindowIds = result.diff.added
    .filter((entry) => entry.kind === 'planning_window')
    .map((entry) => entry.id)
    .filter((id) => activeIds.has(id));
  const replacementFactId = addedWindowIds.length === 1
    ? addedWindowIds[0]
    : latestPlanningWindowId(result.graph, activeIds);
  if (!replacementFactId) return result;

  const superseded = activeWindowIds
    .filter((id) => id !== replacementFactId)
    .map((id) => ({ kind: 'planning_window' as const, id }));
  if (superseded.length === 0) return result;

  const supersededIds = new Set(superseded.map((entry) => entry.id));
  const alreadyRecordedIds = new Set(
    result.diff.superseded
      .filter((entry) => entry.kind === 'planning_window')
      .map((entry) => entry.id),
  );
  const terminalRevision = result.diff.toRevision;
  return {
    ...result,
    graph: {
      ...result.graph,
      factLifecycles: result.graph.factLifecycles.map((entry) =>
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
      ...result.diff,
      superseded: [
        ...result.diff.superseded,
        ...superseded.filter((entry) => !alreadyRecordedIds.has(entry.id)),
      ],
    },
  };
}

export function canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5(params: {
  graph?: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  context: WeeklyPlanningSemanticCanonicalizationContextV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const result = canonicalizeWeeklyPlanningSemanticDocumentV5(params);
  if (result.status !== 'applied' || !result.diff) return result;

  return enforceSingleActivePlanningWindowV5({
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
  });
}
