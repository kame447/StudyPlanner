import type {
  PlanningIntakeState,
  WeeklyPlanningLearningStrategyProposalRecord,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticTypesV5';

const DEFAULT_MEMORY_SESSION_MINUTES = { min: 15, max: 30 } as const;

export interface WeeklyPlanningLearningStrategyEffortFact {
  targetFactId: string;
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unitCode: string | null;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function proposalId(params: {
  kind: WeeklyPlanningLearningStrategyProposalRecord['kind'];
  taskId: string;
  workloadFactId: string;
}): string {
  return `wpp_memory_${stableHash(`${params.taskId}|${params.workloadFactId}|${params.kind}`)}`;
}

function resolvedSupersession(
  workloadFactId: string,
  supersessions: Readonly<Record<string, string>>,
): string {
  let current = workloadFactId;
  const visited = new Set<string>();
  while (supersessions[current] && !visited.has(current)) {
    visited.add(current);
    current = supersessions[current];
  }
  return current;
}

function rebaseProposalWorkloadReferences(params: {
  records: readonly WeeklyPlanningLearningStrategyProposalRecord[];
  workloadSupersessions: Readonly<Record<string, string>>;
}): WeeklyPlanningLearningStrategyProposalRecord[] {
  return params.records.map((record) => {
    if (record.kind === 'mixed_acquisition_review') return { ...record };
    const workloadFactId = resolvedSupersession(
      record.workloadFactId,
      params.workloadSupersessions,
    );
    return workloadFactId === record.workloadFactId
      ? { ...record }
      : { ...record, workloadFactId };
  });
}

function applyProposalDecisions(params: {
  previousRecords: readonly WeeklyPlanningLearningStrategyProposalRecord[];
  document: WeeklyPlanningSemanticDocumentV5;
  turnId: string;
}): WeeklyPlanningLearningStrategyProposalRecord[] {
  const records = params.previousRecords.map((record) => ({ ...record }));
  for (const decision of params.document.decisions) {
    if (decision.target.kind !== 'proposal' || !decision.target.publicId) continue;
    const index = records.findIndex((record) => record.id === decision.target.publicId);
    if (index < 0 || records[index].status !== 'pending') continue;
    if (decision.decision === 'accept') {
      records[index] = { ...records[index], status: 'accepted', decidedAtTurnId: params.turnId };
    } else if (decision.decision === 'reject') {
      records[index] = { ...records[index], status: 'rejected', decidedAtTurnId: params.turnId };
    }
  }
  return records;
}

function blockingEffortFactId(
  compilation: GenericSchedulerInputCompilationResult,
): string | null {
  return compilation.issues.find(
    (issue) => issue.blocking && issue.code === 'missing_effort_estimate',
  )?.factId ?? null;
}

function memoryWorkloadFromCurrentMeaning(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  localToFactId: Readonly<Record<string, string>>;
}): { taskId: string; workloadFactId: string } | null {
  for (const task of params.document.tasks) {
    if (task.study?.activityKind !== 'memorization_retrieval') continue;
    const taskId = params.localToFactId[task.localId];
    if (!taskId) continue;
    const workloads = [
      ...task.workloads,
      ...(task.study.components ?? []).flatMap((component) => component.workloads),
    ];
    for (const workload of workloads) {
      const workloadFactId = params.localToFactId[workload.localId];
      if (workloadFactId) return { taskId, workloadFactId };
    }
  }
  return null;
}

function createInitialMemoryProposal(params: {
  records: WeeklyPlanningLearningStrategyProposalRecord[];
  currentMemoryWorkload: { taskId: string; workloadFactId: string } | null;
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningLearningStrategyProposalRecord[] {
  if (!params.currentMemoryWorkload) return params.records;
  const existing = params.records.find(
    (record) => record.kind === 'spaced_memory_practice'
      && record.workloadFactId === params.currentMemoryWorkload?.workloadFactId,
  );
  if (existing) return params.records;
  return [
    ...params.records,
    {
      id: proposalId({
        kind: 'spaced_memory_practice',
        taskId: params.currentMemoryWorkload.taskId,
        workloadFactId: params.currentMemoryWorkload.workloadFactId,
      }),
      kind: 'spaced_memory_practice',
      taskId: params.currentMemoryWorkload.taskId,
      workloadFactId: params.currentMemoryWorkload.workloadFactId,
      scope: 'week',
      status: 'pending',
      suggestedSessionMinutes: { ...DEFAULT_MEMORY_SESSION_MINUTES },
      selectedSessionMinutes: null,
      createdRevision: params.graphRevision,
      proposedAtTurnId: params.turnId,
      decidedAtTurnId: null,
    },
  ];
}

function createCalibrationProposal(params: {
  records: WeeklyPlanningLearningStrategyProposalRecord[];
  effortEstimates: readonly WeeklyPlanningLearningStrategyEffortFact[];
  workloadFactId: string | null;
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningLearningStrategyProposalRecord[] {
  if (!params.workloadFactId) return params.records;
  const spaced = params.records.find((record) =>
    record.kind === 'spaced_memory_practice'
    && record.workloadFactId === params.workloadFactId
    && record.status === 'accepted');
  if (!spaced) return params.records;
  if (params.records.some((record) =>
    record.kind === 'calibrate_memory_pace'
    && record.workloadFactId === params.workloadFactId)) return params.records;
  const sessionEstimates = params.effortEstimates.filter((estimate) =>
    estimate.targetFactId === params.workloadFactId
    && estimate.kind === 'session_duration'
    && Number.isFinite(estimate.minutes)
    && estimate.minutes > 0);
  if (sessionEstimates.length !== 1) return params.records;
  const sessionMinutes = sessionEstimates[0].minutes;
  return [
    ...params.records,
    {
      id: proposalId({
        kind: 'calibrate_memory_pace',
        taskId: spaced.taskId,
        workloadFactId: params.workloadFactId,
      }),
      kind: 'calibrate_memory_pace',
      taskId: spaced.taskId,
      workloadFactId: params.workloadFactId,
      scope: 'week',
      status: 'pending',
      suggestedSessionMinutes: { min: sessionMinutes, max: sessionMinutes },
      selectedSessionMinutes: sessionMinutes,
      createdRevision: params.graphRevision,
      proposedAtTurnId: params.turnId,
      decidedAtTurnId: null,
    },
  ];
}

export interface WeeklyPlanningLearningStrategyProposalEvaluation {
  records: WeeklyPlanningLearningStrategyProposalRecord[];
  pendingProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
  acceptedProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
  acceptedSpacedProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
  acceptedCalibrationProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
}

export function evaluateWeeklyPlanningLearningStrategyProposalsV5(params: {
  previousState?: PlanningIntakeState;
  document: WeeklyPlanningSemanticDocumentV5;
  localToFactId: Readonly<Record<string, string>>;
  compilation: GenericSchedulerInputCompilationResult;
  effortEstimates?: readonly WeeklyPlanningLearningStrategyEffortFact[];
  workloadSupersessions?: Readonly<Record<string, string>>;
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningLearningStrategyProposalEvaluation {
  const rebasedPreviousRecords = rebaseProposalWorkloadReferences({
    records: params.previousState?.learningStrategyProposalRecords ?? [],
    workloadSupersessions: params.workloadSupersessions ?? {},
  });
  let records = applyProposalDecisions({
    previousRecords: rebasedPreviousRecords,
    document: params.document,
    turnId: params.turnId,
  });

  const currentMemoryWorkload = memoryWorkloadFromCurrentMeaning(params);
  records = createInitialMemoryProposal({
    records,
    currentMemoryWorkload,
    graphRevision: params.graphRevision,
    turnId: params.turnId,
  });

  const missingEffortFactId = blockingEffortFactId(params.compilation);
  records = createCalibrationProposal({
    records,
    effortEstimates: params.effortEstimates ?? [],
    workloadFactId: missingEffortFactId,
    graphRevision: params.graphRevision,
    turnId: params.turnId,
  });

  const decisionTargetProposalId = params.document.decisions.find(
    (decision) => decision.target.kind === 'proposal' && decision.target.publicId,
  )?.target.publicId ?? null;
  const lastRecord = records.length > 0 ? records[records.length - 1] : null;
  const relevantWorkloadFactId = currentMemoryWorkload?.workloadFactId
    ?? missingEffortFactId
    ?? (decisionTargetProposalId
      ? records.find((record) => record.id === decisionTargetProposalId)?.workloadFactId ?? null
      : null)
    ?? records.find((record) => record.status === 'pending')?.workloadFactId
    ?? lastRecord?.workloadFactId
    ?? null;
  const relevant = relevantWorkloadFactId
    ? records.filter((record) => record.workloadFactId === relevantWorkloadFactId)
    : [];
  const acceptedSpacedProposal = relevant.find((record) =>
    record.kind === 'spaced_memory_practice' && record.status === 'accepted') ?? null;
  const acceptedCalibrationProposal = relevant.find((record) =>
    record.kind === 'calibrate_memory_pace' && record.status === 'accepted') ?? null;

  return {
    records,
    pendingProposal: relevant.find((record) => record.status === 'pending') ?? null,
    acceptedProposal: acceptedSpacedProposal ?? acceptedCalibrationProposal,
    acceptedSpacedProposal,
    acceptedCalibrationProposal,
  };
}
