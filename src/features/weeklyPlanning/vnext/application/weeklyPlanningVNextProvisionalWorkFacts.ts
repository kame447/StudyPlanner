import type { WeeklyPlanningVNextProjection, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';

/** One work placed with a provisional timebox (its effort is unknown); typed, never wording. */
export interface VNextProvisionalWorkFact { taskId: string; label: string; minutes: number }

/**
 * The works of the preview being shown that are only placed provisionally. The renderer is told so it does not present the
 * minutes as an estimate. Empty unless the shown preview belongs to this very graph revision, so a stale preview never
 * carries a fact about the current state. A work whose effort was stated (a later estimate replaces the provisional
 * block) is not included.
 */
export function vnextProvisionalWorkFacts(params: {
  state: WeeklyPlanningVNextState;
  projection: WeeklyPlanningVNextProjection;
  preview: { graphRevision: number } | null;
}): VNextProvisionalWorkFact[] {
  if (!params.preview || params.preview.graphRevision !== params.state.graph.revision) return [];
  const { leafOf } = createVNextLineageResolver(params.state.graph);
  const facts = new Map<string, VNextProvisionalWorkFact>();
  for (const owner of params.projection.owners) {
    if (owner.status !== 'ready') continue;
    for (const item of owner.work) {
      if (item.estimateBasis !== 'provisional_timebox' || item.minutes === null) continue;
      const taskId = leafOf(item.taskId) ?? item.taskId;
      if (facts.has(taskId)) continue;
      const title = params.state.graph.tasks.find(task => task.id === taskId)?.title.trim();
      facts.set(taskId, { taskId, label: title || '作業', minutes: item.minutes });
    }
  }
  return [...facts.values()];
}
