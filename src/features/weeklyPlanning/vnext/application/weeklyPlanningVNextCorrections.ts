import type { WeeklyPlanningFactDiffV5 } from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningVNextGraph } from '../weeklyPlanningVNextTypes';

/** An accepted change of an existing quantity or estimate, read from the revision diff. */
export type VNextAcceptedCorrection =
  | { kind: 'workload'; targetTitle: string; quantityRole: string;
    before: { amount: number; unitLabel: string }; after: { amount: number; unitLabel: string } }
  | { kind: 'effort_estimate'; targetTitle: string; effortKind: string;
    before: { minutes: number; unitLabel: string | null }; after: { minutes: number; unitLabel: string | null } };

/**
 * Typed corrections for renderer communication: a superseded workload or effort estimate whose value
 * actually changed this turn. It reads only graph facts and lifecycle links; no user or rendered text.
 */
export function deriveVNextAcceptedCorrections(params: {
  before: WeeklyPlanningVNextGraph;
  after: WeeklyPlanningVNextGraph;
  superseded: WeeklyPlanningFactDiffV5['superseded'];
}): VNextAcceptedCorrection[] {
  const { before, after } = params;
  const titleOf = (taskId: string) => after.tasks.find(task => task.id === taskId)?.title
    ?? before.tasks.find(task => task.id === taskId)?.title ?? '';
  const corrections: VNextAcceptedCorrection[] = [];
  const seen = new Set<string>();
  for (const entry of params.superseded) {
    const replacementId = after.factLifecycles.find(item => item.factId === entry.id)?.supersededByFactId;
    if (!replacementId || seen.has(replacementId)) continue;
    seen.add(replacementId);
    if (entry.kind === 'workload') {
      const old = before.workloads.find(fact => fact.id === entry.id);
      const next = after.workloads.find(fact => fact.id === replacementId);
      if (!old || !next || (old.amount === next.amount && old.unitLabel === next.unitLabel)) continue;
      corrections.push({ kind: 'workload', targetTitle: titleOf(next.taskId), quantityRole: next.quantityRole,
        before: { amount: old.amount, unitLabel: old.unitLabel }, after: { amount: next.amount, unitLabel: next.unitLabel } });
    } else if (entry.kind === 'effort_estimate') {
      const old = before.effortEstimates.find(fact => fact.id === entry.id);
      const next = after.effortEstimates.find(fact => fact.id === replacementId);
      if (!old || !next || old.minutes === next.minutes) continue;
      corrections.push({ kind: 'effort_estimate', targetTitle: titleOf(next.taskId), effortKind: next.kind,
        before: { minutes: old.minutes, unitLabel: old.unitCode === 'custom' ? old.unitLabel : null },
        after: { minutes: next.minutes, unitLabel: next.unitCode === 'custom' ? next.unitLabel : null } });
    }
  }
  return corrections;
}
