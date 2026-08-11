import type { WeeklyPlanningGroundingRecord } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';

function activePlanningWindows(graph: WeeklyPlanningFactGraphV5) {
  if (graph.factLifecycles.length === 0) return [...graph.planningWindows];
  return graph.planningWindows.filter((window) =>
    isWeeklyPlanningFactActiveV5(graph, window.id));
}

function recordId(params: {
  targetFactId: string;
  startDate: string;
  endDate: string;
}): string {
  return `grounding:${params.targetFactId}:${params.startDate}:${params.endDate}`;
}

function decisionForPlanningWindow(
  graph: WeeklyPlanningFactGraphV5,
  factId: string,
): 'accept' | 'reject' | 'modify' | null {
  const decisions = graph.decisionIntents
    .filter((decision) =>
      (graph.factLifecycles.length === 0 || isWeeklyPlanningFactActiveV5(graph, decision.id))
      && decision.target.kind === 'planning_window'
      && (decision.target.factId === factId || decision.target.publicId === factId))
    .sort((left, right) => right.createdRevision - left.createdRevision);
  return decisions[0]?.decision ?? null;
}

function reconcilePriorRecords(params: {
  previousRecords: readonly WeeklyPlanningGroundingRecord[];
  nextGraph: WeeklyPlanningFactGraphV5;
  currentTurnId: string;
}): WeeklyPlanningGroundingRecord[] {
  return params.previousRecords.map((record) => {
    if (!isWeeklyPlanningFactActiveV5(params.nextGraph, record.targetFactId)) {
      return record.status === 'rejected'
        ? { ...record }
        : { ...record, status: 'rejected' as const };
    }

    const decision = decisionForPlanningWindow(params.nextGraph, record.targetFactId);
    if (decision === 'accept') {
      return {
        ...record,
        status: 'explicitly_accepted' as const,
        acceptedAtTurnId: params.currentTurnId,
      };
    }
    if (decision === 'reject') {
      return { ...record, status: 'rejected' as const };
    }
    if (decision === 'modify') {
      return { ...record, status: 'contested' as const };
    }
    return { ...record };
  });
}

export function reconcileWeeklyPlanningGroundingRecordsV5(params: {
  previousRecords: readonly WeeklyPlanningGroundingRecord[];
  previousGraph: WeeklyPlanningFactGraphV5;
  nextGraph: WeeklyPlanningFactGraphV5;
  resolvedHorizon: { startDate: string; endDate: string } | null;
  currentTurnId: string;
  continuationAccepted: boolean;
}): WeeklyPlanningGroundingRecord[] {
  const reconciled = reconcilePriorRecords({
    previousRecords: params.previousRecords,
    nextGraph: params.nextGraph,
    currentTurnId: params.currentTurnId,
  });

  const windows = activePlanningWindows(params.nextGraph);
  if (windows.length !== 1 || !params.resolvedHorizon) return reconciled;
  const window = windows[0];
  // Phase 3 deliberately grounds week-scale deictic expressions first. Relative
  // days already use the captured request clock, but their conversational
  // proposal wording is kept unchanged until the dedicated day-grounding unit.
  if (window.kind !== 'relative_week') return reconciled;

  const id = recordId({
    targetFactId: window.id,
    startDate: params.resolvedHorizon.startDate,
    endDate: params.resolvedHorizon.endDate,
  });
  const existingIndex = reconciled.findIndex((record) => record.id === id);
  if (existingIndex >= 0) {
    const existing = reconciled[existingIndex];
    if (existing.status === 'proposed' && params.continuationAccepted) {
      reconciled[existingIndex] = {
        ...existing,
        status: 'continuation_accepted',
        acceptedAtTurnId: params.currentTurnId,
      };
    }
    return reconciled;
  }

  const decision = decisionForPlanningWindow(params.nextGraph, window.id);
  const status: WeeklyPlanningGroundingRecord['status'] = decision === 'accept'
    ? 'explicitly_accepted'
    : decision === 'reject'
      ? 'rejected'
      : decision === 'modify'
        ? 'contested'
        : 'proposed';
  reconciled.push({
    id,
    targetFactId: window.id,
    interpretationKind: 'relative_date_resolution',
    status,
    sourceExpression: window.value,
    startDate: params.resolvedHorizon.startDate,
    endDate: params.resolvedHorizon.endDate,
    proposedAtTurnId: params.currentTurnId,
    acceptedAtTurnId: status === 'explicitly_accepted' ? params.currentTurnId : null,
  });
  return reconciled;
}
