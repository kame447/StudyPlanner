import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningStableV5PreviewSchedulerResult } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { evaluateWeeklyPlanningInsufficientCapacityProposalV5 } from './weeklyPlanningStableV5CapacityProposal';
import { projectStableV5CompatibilityOutput } from './weeklyPlanningStableV5CompatibilityState';
import { withStableV5GroundingProposal } from './weeklyPlanningStableV5GroundingFlow';
import type {
  WeeklyPlanningStableV5PlanningEvaluation,
} from './weeklyPlanningStableV5PlanningEvaluation';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import {
  stableV5IssueTaskLabel,
  stableV5MissingSchedulableWorkQuestion,
  renderStableV5RuntimeQuestion,
} from './weeklyPlanningStableV5RuntimeQuestions';
import type { WeeklyPlanningStableV5SemanticTurnResult } from './weeklyPlanningStableV5SemanticTurn';

type SuccessfulSemanticTurn = Extract<
  WeeklyPlanningStableV5SemanticTurnResult,
  { status: 'success' }
>;

export type WeeklyPlanningStableV5PrePreviewRoute =
  | {
      kind: 'respond';
      output: WeeklyPlanningTurnExecutionResult;
    }
  | {
      kind: 'schedule_preview';
      schedulerInput: GenericSchedulerInput;
    };

function traceRuntimeBranch(params: {
  requestId: string;
  branch: string;
  basis: unknown;
  output: unknown;
  severity?: 'debug' | 'info' | 'warn' | 'error';
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.requestId,
    stage: 'runtime_branch_selected',
    severity: params.severity ?? 'info',
    data: {
      branch: params.branch,
      basis: params.basis,
      output: params.output,
    },
  });
}

function groundedMessage(params: {
  message: string;
  records: Parameters<typeof withStableV5GroundingProposal>[0]['records'];
  currentTurnId: string;
}): string {
  return withStableV5GroundingProposal(params);
}

function respond(output: WeeklyPlanningTurnExecutionResult): WeeklyPlanningStableV5PrePreviewRoute {
  return { kind: 'respond', output };
}

function estimateForWorkloadFactId(
  details: Record<string, string | number | boolean | null>,
): string | undefined {
  return typeof details.estimateForWorkloadFactId === 'string'
    && details.estimateForWorkloadFactId.length > 0
    ? details.estimateForWorkloadFactId
    : undefined;
}

function effortQuestionBasis(
  details: Record<string, string | number | boolean | null>,
): 'completed_workload_total' | undefined {
  return details.questionBasis === 'completed_workload_total'
    ? 'completed_workload_total'
    : undefined;
}

function routeBeforePreview(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  graph: WeeklyPlanningFactGraphV5;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
}): WeeklyPlanningStableV5PrePreviewRoute {
  const { input, graph, evaluation } = params;
  const {
    groundingRecords,
    compilation,
    learningStrategyProposals,
    repairDecision,
    dialogue,
    planningIntent,
    semanticChanged,
    previousDraftGenerationIntent,
    authorized,
  } = evaluation;
  const schedulerInput = compilation.input;

  if (learningStrategyProposals.pendingProposal) {
    const proposal = learningStrategyProposals.pendingProposal;
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message: '',
      draftCandidates: [],
      questionCode: 'learning_strategy_proposal',
      questionFactId: proposal.workloadFactId,
      questionKind: 'options',
      questionActionId: proposal.id,
      authorized,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
      learningStrategyProposalRecords: learningStrategyProposals.records,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'learning_strategy_proposal',
      basis: {
        proposal,
        groundingRecords,
        repairDecision,
      },
      output,
    });
    return respond(output);
  }

  if (dialogue.status === 'ask_question') {
    const sessionDurationQuestion = dialogue.question.effortMeasurement === 'session_duration';
    const renderedQuestion = sessionDurationQuestion
      ? ''
      : renderStableV5RuntimeQuestion(graph, dialogue.question);
    const message = sessionDurationQuestion
      ? ''
      : groundedMessage({
          message: renderedQuestion,
          records: groundingRecords,
          currentTurnId: input.traceRequestId,
        });
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: [],
      questionCode: dialogue.question.code,
      questionFactId: dialogue.question.factId ?? undefined,
      questionIntent: dialogue.question.effortMeasurement ?? undefined,
      questionEstimateForWorkloadFactId: estimateForWorkloadFactId(dialogue.question.details),
      questionBasis: effortQuestionBasis(dialogue.question.details),
      authorized,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
      learningStrategyProposalRecords: learningStrategyProposals.records,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'ask_question',
      basis: {
        dialogue,
        renderedQuestion: message || null,
        issueLabel: stableV5IssueTaskLabel(graph, dialogue.question),
        groundingRecords,
        repairDecision,
        learningStrategyProposals,
      },
      output,
      severity: 'warn',
    });
    return respond(output);
  }

  if (dialogue.status === 'nothing_to_schedule' || !schedulerInput) {
    const missingWork = stableV5MissingSchedulableWorkQuestion(graph);
    const message = groundedMessage({
      message: missingWork.message,
      records: groundingRecords,
      currentTurnId: input.traceRequestId,
    });
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: [],
      questionCode: missingWork.questionCode,
      questionFactId: missingWork.targetFactId ?? undefined,
      questionIntent: missingWork.intent,
      authorized,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
      learningStrategyProposalRecords: learningStrategyProposals.records,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'nothing_to_schedule',
      basis: {
        dialogueStatus: dialogue.status,
        compilationStatus: compilation.status,
        compilationInputExists: Boolean(schedulerInput),
        recognizedTaskTitles: missingWork.taskTitles,
        questionCode: missingWork.questionCode,
        questionFactId: missingWork.targetFactId,
        questionIntent: missingWork.intent,
        groundingRecords,
        repairDecision,
      },
      output,
      severity: 'warn',
    });
    return respond(output);
  }

  if (!authorized && input.previousState?.status === 'draft_ready' && !semanticChanged) {
    const message = groundedMessage({
      message: '仮予定候補は変更していません。内容を修正する場合は条件を入力してください。問題なければ下の「この内容で仮予定にする」ボタンを押してください。',
      records: groundingRecords,
      currentTurnId: input.traceRequestId,
    });
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: [],
      authorized: false,
      preserveExistingPreview: true,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
      learningStrategyProposalRecords: learningStrategyProposals.records,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'preview_unchanged',
      basis: {
        planningIntent,
        semanticChanged,
        previousStatus: input.previousState.status,
        groundingRecords,
        repairDecision,
      },
      output,
    });
    return respond(output);
  }

  if (!authorized) {
    const message = groundedMessage({
      message: '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。',
      records: groundingRecords,
      currentTurnId: input.traceRequestId,
    });
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: [],
      authorized: false,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
      learningStrategyProposalRecords: learningStrategyProposals.records,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'authorization_required',
      basis: {
        planningIntent,
        previousDraftGenerationIntent,
        criterion: 'no current create_plan, no durable user_authorized, and no draft_ready update_plan change',
        groundingRecords,
        repairDecision,
      },
      output,
    });
    return respond(output);
  }

  return {
    kind: 'schedule_preview',
    schedulerInput,
  };
}

function routeAfterPreview(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  semanticTurn: SuccessfulSemanticTurn;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  preview: WeeklyPlanningStableV5PreviewSchedulerResult;
}): WeeklyPlanningTurnExecutionResult {
  const { input, semanticTurn, evaluation, preview } = params;
  const { semantic } = semanticTurn;
  const {
    groundingRecords,
    compilation,
    learningStrategyProposals,
    repairDecision,
    dialogue,
    authorized,
  } = evaluation;

  if (preview.status === 'insufficient_capacity') {
    const capacityProposal = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: learningStrategyProposals.records,
      compilation,
      preview,
      graphRevision: semantic.graph.revision,
      turnId: input.traceRequestId,
    });
    if (capacityProposal.pendingProposal) {
      const proposal = capacityProposal.pendingProposal;
      const output = projectStableV5CompatibilityOutput({
        previousState: input.previousState,
        userText: input.userText,
        message: '',
        draftCandidates: [],
        questionCode: 'learning_strategy_proposal',
        questionFactId: proposal.workloadFactId,
        questionKind: 'options',
        questionActionId: proposal.id,
        authorized: true,
        groundingRecords,
        repairAgenda: repairDecision.agenda,
        learningStrategyProposalRecords: capacityProposal.records,
      });
      traceRuntimeBranch({
        requestId: input.traceRequestId,
        branch: 'capacity_learning_strategy_proposal',
        basis: { preview, proposal, groundingRecords, repairDecision },
        output,
        severity: 'warn',
      });
      return output;
    }

    const message = groundedMessage({
      message: '指定された期間と空き時間には、すべての作業を安全に配置できませんでした。期間を広げるか、作業量または利用できる時間を調整してください。',
      records: groundingRecords,
      currentTurnId: input.traceRequestId,
    });
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: [],
      questionCode: 'insufficient_capacity',
      authorized: true,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
      learningStrategyProposalRecords: capacityProposal.records,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'preview_insufficient_capacity',
      basis: { preview, groundingRecords, repairDecision },
      output,
      severity: 'warn',
    });
    return output;
  }

  if (preview.status === 'empty') {
    const missingWork = stableV5MissingSchedulableWorkQuestion(semantic.graph);
    const message = groundedMessage({
      message: missingWork.message,
      records: groundingRecords,
      currentTurnId: input.traceRequestId,
    });
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: [],
      questionCode: missingWork.questionCode,
      questionFactId: missingWork.targetFactId ?? undefined,
      questionIntent: missingWork.intent,
      authorized: true,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
      learningStrategyProposalRecords: learningStrategyProposals.records,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'preview_empty',
      basis: {
        preview,
        questionCode: missingWork.questionCode,
        questionFactId: missingWork.targetFactId,
        questionIntent: missingWork.intent,
        groundingRecords,
        repairDecision,
      },
      output,
      severity: 'warn',
    });
    return output;
  }

  console.info('[WeeklyPlanning Stable V5] turn completed', {
    schemaVersion: semantic.normalization.diagnostics.schemaVersion,
    graphRevision: semantic.graph.revision,
    normalizerAttempts: semantic.normalization.diagnostics.attemptCount,
    repairAttempted: semantic.normalization.diagnostics.repairAttempted,
    schedulerStatus: compilation.status,
    candidateCount: preview.candidates.length,
  });
  const message = groundedMessage({
    message: `${preview.candidates.length}件の仮予定候補を作りました。内容を確認して、問題なければ下の「この内容で仮予定にする」ボタンを押してください。`,
    records: groundingRecords,
    currentTurnId: input.traceRequestId,
  });
  const output = projectStableV5CompatibilityOutput({
    previousState: input.previousState,
    userText: input.userText,
    message,
    draftCandidates: preview.candidates,
    authorized: true,
    groundingRecords,
    repairAgenda: repairDecision.agenda,
    learningStrategyProposalRecords: learningStrategyProposals.records,
  });
  traceRuntimeBranch({
    requestId: input.traceRequestId,
    branch: 'preview_ready',
    basis: {
      compilationStatus: compilation.status,
      dialogueStatus: dialogue.status,
      authorized,
      preview,
      groundingRecords,
      repairDecision,
    },
    output,
  });
  return output;
}

export const weeklyPlanningStableV5ResponseRouter = {
  beforePreview: routeBeforePreview,
  afterPreview: routeAfterPreview,
} as const;
