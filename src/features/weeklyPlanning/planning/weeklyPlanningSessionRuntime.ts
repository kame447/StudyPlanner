import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';

export interface WeeklyPlanningSessionRuntimeSnapshot {
  conversationId: string;
  stateRevision: number;
  proposalRecords: AssumptionProposalRecord[];
  updatedAt: number;
}

let currentSnapshot: WeeklyPlanningSessionRuntimeSnapshot | null = null;

function cloneRecords(records: readonly AssumptionProposalRecord[]): AssumptionProposalRecord[] {
  return records.map((record) => ({
    ...record,
    sourceFactRefs: [...record.sourceFactRefs],
    ...(record.resolvedBy ? { resolvedBy: { ...record.resolvedBy } } : {}),
  }));
}

export function publishWeeklyPlanningSessionRuntime(params: {
  conversationId: string;
  stateRevision: number;
  proposalRecords: readonly AssumptionProposalRecord[];
  updatedAt?: number;
}): WeeklyPlanningSessionRuntimeSnapshot {
  const snapshot: WeeklyPlanningSessionRuntimeSnapshot = {
    conversationId: params.conversationId,
    stateRevision: params.stateRevision,
    proposalRecords: cloneRecords(params.proposalRecords),
    updatedAt: params.updatedAt ?? Date.now(),
  };
  currentSnapshot = snapshot;
  return {
    ...snapshot,
    proposalRecords: cloneRecords(snapshot.proposalRecords),
  };
}

export function getWeeklyPlanningSessionRuntime(): WeeklyPlanningSessionRuntimeSnapshot | null {
  return currentSnapshot
    ? {
        ...currentSnapshot,
        proposalRecords: cloneRecords(currentSnapshot.proposalRecords),
      }
    : null;
}

export function clearWeeklyPlanningSessionRuntime(): void {
  currentSnapshot = null;
}
