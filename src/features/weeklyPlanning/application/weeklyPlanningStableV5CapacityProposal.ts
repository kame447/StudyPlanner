import type {
  WeeklyPlanningLearningStrategyProposalRecord,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';

export interface WeeklyPlanningCapacityPreviewEvidenceV5 {
  status: 'ready' | 'empty' | 'insufficient_capacity';
  unscheduledWorkItemIds: readonly string[];
}

export interface WeeklyPlanningCapacityProposalEvaluationV5 {
  records: WeeklyPlanningLearningStrategyProposalRecord[];
  pendingProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
}

export function evaluateWeeklyPlanningInsufficientCapacityProposalV5(params: {
  records: readonly WeeklyPlanningLearningStrategyProposalRecord[];
  compilation: GenericSchedulerInputCompilationResult;
  preview: WeeklyPlanningCapacityPreviewEvidenceV5;
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningCapacityProposalEvaluationV5 {
  const records = params.records.map((record) => ({ ...record }));
  if (params.preview.status !== 'insufficient_capacity' || !params.compilation.input) {
    return { records, pendingProposal: null };
  }
  if (records.some((record) => record.status === 'pending')) {
    return { records, pendingProposal: null };
  }

  const unscheduledIds = new Set(params.preview.unscheduledWorkItemIds);
  const unscheduledWorkloadIds = new Set(
    params.compilation.input.movableWorkItems
      .filter((item) => unscheduledIds.has(item.id))
      .map((item) => item.workloadFactId),
  );
  const acceptedSpacing = records.find((record) =>
    record.kind === 'spaced_memory_practice'
    && record.status === 'accepted'
    && unscheduledWorkloadIds.has(record.workloadFactId));
  if (!acceptedSpacing) return { records, pendingProposal: null };

  const existing = records.find((record) =>
    record.kind === 'mixed_acquisition_review'
    && record.workloadFactId === acceptedSpacing.workloadFactId);
  if (existing) {
    return {
      records,
      pendingProposal: existing.status === 'pending' ? existing : null,
    };
  }

  const proposal: WeeklyPlanningLearningStrategyProposalRecord = {
    id: `wpp_capacity_${acceptedSpacing.id}`,
    kind: 'mixed_acquisition_review',
    taskId: acceptedSpacing.taskId,
    workloadFactId: acceptedSpacing.workloadFactId,
    scope: 'week',
    status: 'pending',
    suggestedSessionMinutes: { ...acceptedSpacing.suggestedSessionMinutes },
    selectedSessionMinutes: null,
    capacityStrategy: {
      trigger: 'insufficient_capacity',
      acquisition: 'longer_sessions',
      review: 'short_distributed_sessions',
      unscheduledWorkItemIds: [...params.preview.unscheduledWorkItemIds],
    },
    createdRevision: params.graphRevision,
    proposedAtTurnId: params.turnId,
    decidedAtTurnId: null,
  };
  return {
    records: [...records, proposal],
    pendingProposal: proposal,
  };
}
