import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningStableV5CandidateMetadata,
  WeeklyPlanningStableV5PreviewSchedulerResult,
} from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { projectStableV5CompatibilityOutput } from './weeklyPlanningStableV5CompatibilityState';
import { withStableV5GroundingProposal } from './weeklyPlanningStableV5GroundingFlow';
import type {
  WeeklyPlanningStableV5PlanningEvaluation,
} from './weeklyPlanningStableV5PlanningEvaluation';
import type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';

interface ProvisionalCapacityDecisionV5 {
  unscheduledTaskIds: string[];
  partlyScheduledTaskIds: string[];
  priorityRelationFactIds: string[];
}

function candidateTaskId(candidate: WeeklyDraftCandidate): string | null {
  const metadata = (candidate as WeeklyDraftCandidate & {
    stableV5Metadata?: WeeklyPlanningStableV5CandidateMetadata;
  }).stableV5Metadata;
  return metadata?.taskId ?? null;
}

function provisionalCapacityDecision(params: {
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  preview: WeeklyPlanningStableV5PreviewSchedulerResult;
}): ProvisionalCapacityDecisionV5 | null {
  if (
    params.preview.status !== 'insufficient_capacity'
    || params.preview.candidates.length === 0
    || params.preview.unscheduledWorkItemIds.length === 0
    || !params.evaluation.provisionalTimeboxProjection.source
  ) return null;

  const schedulerInput = params.evaluation.compilation.input;
  if (!schedulerInput) return null;

  const itemById = new Map(
    schedulerInput.movableWorkItems.map((item) => [item.id, item]),
  );
  const unscheduledItems = params.preview.unscheduledWorkItemIds.map((id) => itemById.get(id));
  if (unscheduledItems.some((item) => !item)) return null;

  const scheduledTaskIds = new Set(
    params.preview.candidates
      .map(candidateTaskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
  if (scheduledTaskIds.size === 0) return null;

  const priorityRelations = schedulerInput.relations.filter((relation) =>
    relation.kind === 'priority_over');
  const acceptedRelations = new Set<string>();
  const unscheduledTaskIds = [...new Set(unscheduledItems.map((item) => item!.taskId))];

  for (const taskId of unscheduledTaskIds) {
    const supporting = priorityRelations.filter((relation) =>
      relation.toTaskId === taskId && scheduledTaskIds.has(relation.fromTaskId));
    if (supporting.length === 0) return null;
    supporting.forEach((relation) => acceptedRelations.add(relation.factId));
  }

  return {
    unscheduledTaskIds,
    partlyScheduledTaskIds: unscheduledTaskIds.filter((taskId) => scheduledTaskIds.has(taskId)),
    priorityRelationFactIds: [...acceptedRelations].sort(),
  };
}

function taskLabels(
  input: GenericSchedulerInput,
  evaluation: WeeklyPlanningStableV5PlanningEvaluation,
  taskIds: readonly string[],
): string[] {
  const taskIdSet = new Set(taskIds);
  const graphLabels = evaluation.activeGraph.tasks
    .filter((task) => taskIdSet.has(task.id))
    .map((task) => task.title.trim())
    .filter(Boolean);
  if (graphLabels.length > 0) return [...new Set(graphLabels)];
  return [...new Set(
    input.movableWorkItems
      .filter((item) => taskIdSet.has(item.taskId))
      .map((item) => item.label.trim())
      .filter(Boolean),
  )];
}

export function projectWeeklyPlanningProvisionalCapacityPreviewV5(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  preview: WeeklyPlanningStableV5PreviewSchedulerResult;
}): WeeklyPlanningTurnExecutionResult | null {
  const decision = provisionalCapacityDecision({
    evaluation: params.evaluation,
    preview: params.preview,
  });
  const schedulerInput = params.evaluation.compilation.input;
  if (!decision || !schedulerInput) return null;

  // Extent comes from candidate task identity, never from a display-label match.
  const partlyScheduled = new Set(decision.partlyScheduledTaskIds);
  const entirelyOmittedLabels = taskLabels(schedulerInput, params.evaluation,
    decision.unscheduledTaskIds.filter((taskId) => !partlyScheduled.has(taskId)));
  const partlyOmittedLabels = taskLabels(schedulerInput, params.evaluation,
    decision.partlyScheduledTaskIds);
  const omittedText = [
    entirelyOmittedLabels.length > 0
      ? `${entirelyOmittedLabels.join('・')}は容量不足のため候補に入れていません。` : '',
    partlyOmittedLabels.length > 0
      ? `${partlyOmittedLabels.join('・')}の一部は容量不足のため候補に入れていません。` : '',
  ].join('') || '容量不足のため候補に入らなかった作業があります。';
  const message = withStableV5GroundingProposal({
    message: `空き時間内で指定された優先順位に沿って${params.preview.candidates.length}件の仮予定候補を作りました。${omittedText}内容を確認して、必要なら条件を修正してください。問題なければ下の「この内容で仮予定にする」ボタンを押してください。`,
    records: params.evaluation.groundingRecords,
    currentTurnId: params.input.traceRequestId,
  });
  const compatibilityOutput = projectStableV5CompatibilityOutput({
    previousState: params.input.previousState,
    userText: params.input.userText,
    message,
    draftCandidates: params.preview.candidates,
    authorized: true,
    groundingRecords: params.evaluation.groundingRecords,
    repairAgenda: params.evaluation.repairDecision.agenda,
    learningStrategyProposalRecords: params.evaluation.learningStrategyProposals.records,
  });
  const output: WeeklyPlanningTurnExecutionResult = {
    ...compatibilityOutput,
    // This disclosure is application-owned: omitting lower-priority work is a
    // deterministic scheduling decision, not wording the dialogue model may hide.
    responseSource: 'system',
  };

  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'runtime_branch_selected',
    severity: 'warn',
    data: {
      branch: 'preview_ready_provisional_capacity',
      basis: {
        authorized: true,
        compilationStatus: params.evaluation.compilation.status,
        dialogueStatus: params.evaluation.dialogue.status,
        preview: params.preview,
        priorityRelationFactIds: decision.priorityRelationFactIds,
        unscheduledTaskIds: decision.unscheduledTaskIds,
      },
      output,
    },
  });

  return output;
}
