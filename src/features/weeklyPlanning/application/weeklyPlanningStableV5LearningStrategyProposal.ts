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

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function proposalId(taskId: string, workloadFactId: string): string {
  return `wpp_memory_${stableHash(`${taskId}|${workloadFactId}|spaced_memory_practice`)}`;
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
      records[index] = {
        ...records[index],
        status: 'accepted',
        decidedAtTurnId: params.turnId,
      };
    } else if (decision.decision === 'reject') {
      records[index] = {
        ...records[index],
        status: 'rejected',
        decidedAtTurnId: params.turnId,
      };
    }
  }
  return records;
}

function memoryWorkloadFromCurrentMeaning(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  localToFactId: Readonly<Record<string, string>>;
  compilation: GenericSchedulerInputCompilationResult;
}): { taskId: string; workloadFactId: string } | null {
  const missingEffort = params.compilation.issues.find(
    (issue) => issue.blocking && issue.code === 'missing_effort_estimate',
  );
  if (!missingEffort?.factId) return null;

  for (const task of params.document.tasks) {
    if (task.study?.activityKind !== 'memorization_retrieval') continue;
    const taskId = params.localToFactId[task.localId];
    if (!taskId) continue;
    const workloads = [
      ...task.workloads,
      ...(task.study?.components ?? []).flatMap((component) => component.workloads),
    ];
    for (const workload of workloads) {
      const workloadFactId = params.localToFactId[workload.localId];
      if (workloadFactId === missingEffort.factId) {
        return { taskId, workloadFactId };
      }
    }
  }
  return null;
}

export interface WeeklyPlanningLearningStrategyProposalEvaluation {
  records: WeeklyPlanningLearningStrategyProposalRecord[];
  pendingProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
  acceptedProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
}

export function evaluateWeeklyPlanningLearningStrategyProposalsV5(params: {
  previousState?: PlanningIntakeState;
  document: WeeklyPlanningSemanticDocumentV5;
  localToFactId: Readonly<Record<string, string>>;
  compilation: GenericSchedulerInputCompilationResult;
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningLearningStrategyProposalEvaluation {
  let records = applyProposalDecisions({
    previousRecords: params.previousState?.learningStrategyProposalRecords ?? [],
    document: params.document,
    turnId: params.turnId,
  });

  const currentMemoryWorkload = memoryWorkloadFromCurrentMeaning(params);
  if (currentMemoryWorkload) {
    const existing = records.find(
      (record) => record.kind === 'spaced_memory_practice'
        && record.workloadFactId === currentMemoryWorkload.workloadFactId,
    );
    if (!existing) {
      records = [
        ...records,
        {
          id: proposalId(currentMemoryWorkload.taskId, currentMemoryWorkload.workloadFactId),
          kind: 'spaced_memory_practice',
          taskId: currentMemoryWorkload.taskId,
          workloadFactId: currentMemoryWorkload.workloadFactId,
          scope: 'week',
          status: 'pending',
          suggestedSessionMinutes: { ...DEFAULT_MEMORY_SESSION_MINUTES },
          createdRevision: params.graphRevision,
          proposedAtTurnId: params.turnId,
          decidedAtTurnId: null,
        },
      ];
    }
  }

  const blockingEffortFactId = params.compilation.issues.find(
    (issue) => issue.blocking && issue.code === 'missing_effort_estimate',
  )?.factId;
  const relevant = blockingEffortFactId
    ? records.filter((record) => record.workloadFactId === blockingEffortFactId)
    : [];

  return {
    records,
    pendingProposal: relevant.find((record) => record.status === 'pending') ?? null,
    acceptedProposal: relevant.find((record) => record.status === 'accepted') ?? null,
  };
}

export function renderWeeklyPlanningMemoryStrategyProposalV5(params: {
  taskLabel: string;
  proposal: WeeklyPlanningLearningStrategyProposalRecord;
}): string {
  const { min, max } = params.proposal.suggestedSessionMinutes;
  return `「${params.taskLabel}」は暗記・想起が中心の学習なので、まとめて一度に繰り返すより、間隔を空けて何度か思い出す機会を作る方が定着しやすいです。まずは1回${min}〜${max}分くらいに分けて組んでみますか？`;
}

export function renderWeeklyPlanningMemorySessionDurationQuestionV5(params: {
  taskLabel: string;
  proposal: WeeklyPlanningLearningStrategyProposalRecord;
}): string {
  const { min, max } = params.proposal.suggestedSessionMinutes;
  return `では、「${params.taskLabel}」は1回何分くらいにしますか？ ${min}〜${max}分くらいを目安にできます。`;
}
