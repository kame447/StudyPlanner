import type { WeeklyPlanningLearningStrategyProposalRecord } from '../intake/weeklyPlanningIntakeTypes';
import {
  getWeeklyPlanningMemoryPaceRuntimeV5,
} from '../personalization/weeklyPlanningMemoryPaceRuntimeV5';
import type {
  GenericSchedulerObservedEstimateOverride,
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticTypesV5';

export interface WeeklyPlanningMemoryObservedPaceProjectionV5 {
  estimateOverrides: GenericSchedulerObservedEstimateOverride[];
  appliedWorkloadFactIds: string[];
}

function memoryWorkloadFactIds(params: {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  localToFactId: Readonly<Record<string, string>>;
  previousRecords: readonly WeeklyPlanningLearningStrategyProposalRecord[];
}): Set<string> {
  const ids = new Set<string>();
  params.previousRecords.forEach((record) => ids.add(record.workloadFactId));
  params.document?.tasks.forEach((task) => {
    if (task.study?.activityKind !== 'memorization_retrieval') return;
    const workloads = [
      ...task.workloads,
      ...(task.study.components ?? []).flatMap((component) => component.workloads),
    ];
    workloads.forEach((workload) => {
      const factId = params.localToFactId[workload.localId];
      if (factId) ids.add(factId);
    });
  });
  return ids;
}

export function projectWeeklyPlanningMemoryObservedPaceV5(params: {
  ownerId: string;
  graph: WeeklyPlanningGenericSchedulerGraphView;
  document: WeeklyPlanningSemanticDocumentV5 | null;
  localToFactId: Readonly<Record<string, string>>;
  previousRecords: readonly WeeklyPlanningLearningStrategyProposalRecord[];
}): WeeklyPlanningMemoryObservedPaceProjectionV5 {
  const eligibleWorkloadIds = memoryWorkloadFactIds(params);
  const estimateOverrides: GenericSchedulerObservedEstimateOverride[] = [];

  params.graph.workloads.forEach((workload) => {
    if (!eligibleWorkloadIds.has(workload.id)) return;
    const hasExplicitDuration = params.graph.effortEstimates.some((estimate) =>
      estimate.targetFactId === workload.id
      && (estimate.kind === 'total_duration' || estimate.kind === 'duration_per_unit'));
    if (hasExplicitDuration) return;

    const observed = getWeeklyPlanningMemoryPaceRuntimeV5(params.ownerId, workload.unitCode);
    const minutesPerUnit = observed?.medianMinutesPerUnit ?? null;
    if (
      !observed
      || observed.observationCount <= 0
      || minutesPerUnit === null
      || !Number.isFinite(minutesPerUnit)
      || minutesPerUnit <= 0
    ) return;

    estimateOverrides.push({
      workloadFactId: workload.id,
      estimatedMinutes: workload.amount * minutesPerUnit,
      evidenceKind: 'observed_memory_pace',
      observationCount: observed.observationCount,
    });
  });

  return {
    estimateOverrides,
    appliedWorkloadFactIds: estimateOverrides.map((override) => override.workloadFactId),
  };
}
