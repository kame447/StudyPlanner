import type {
  GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  projectStableV5CompatibilityOutput,
} from './weeklyPlanningStableV5CompatibilityState';
import {
  withStableV5GroundingProposal,
} from './weeklyPlanningStableV5GroundingFlow';
import {
  evaluateWeeklyPlanningStableV5Planning,
} from './weeklyPlanningStableV5PlanningEvaluation';
import {
  executeWeeklyPlanningStableV5Preview,
} from './weeklyPlanningStableV5PreviewExecution';
import type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';
import {
  stableV5BlockingIssueCode,
  stableV5IssueTaskLabel,
  stableV5MissingSchedulableWorkQuestion,
  renderStableV5RuntimeQuestion,
} from './weeklyPlanningStableV5RuntimeQuestions';
import {
  activeStableV5PlanningWindows,
} from './weeklyPlanningStableV5SemanticContext';
import {
  executeWeeklyPlanningStableV5SemanticTurn,
} from './weeklyPlanningStableV5SemanticTurn';
import {
  stageWeeklyPlanningStableV5Turn,
} from './weeklyPlanningStableV5TurnStaging';

export type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';
export {
  isWeeklyPlanningStableV5PreviewAuthorized,
} from './weeklyPlanningStableV5PlanningEvaluation';

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

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const semanticTurn = await executeWeeklyPlanningStableV5SemanticTurn(input);
  if (semanticTurn.status === 'failure') return semanticTurn.output;

  const { requestContext, semantic } = semanticTurn;
  stageWeeklyPlanningStableV5Turn({ input, semanticTurn });

  const evaluation = evaluateWeeklyPlanningStableV5Planning({
    input,
    semanticTurn,
  });
  const {
    continuationAccepted,
    groundingRecords,
    horizon,
    schedulerContext,
    externalSources,
    activeGraph,
    compilation,
    repairDecision,
    dialogue,
    planningIntent,
    semanticChanged,
    previousDraftGenerationIntent,
    authorized,
  } = evaluation;

  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_scheduler_dialogue_evaluated',
    severity: dialogue.status === 'ask_question' ? 'warn' : 'info',
    data: {
      activePlanningWindows: activeStableV5PlanningWindows(semantic.graph),
      selectedDate: input.selectedDate,
      requestContext,
      resolvedHorizon: horizon,
      grounding: { continuationAccepted, records: groundingRecords },
      repair: {
        mode: repairDecision.mode,
        deferredIssueIds: repairDecision.deferredIssueIds,
        reopenedIssueIds: repairDecision.reopenedIssueIds,
        agenda: repairDecision.agenda,
      },
      schedulerInput: {
        graph: activeGraph,
        context: schedulerContext,
        externalSources,
      },
      compilation,
      dialogue,
      firstBlockingIssueCodeInCompilationOrder: stableV5BlockingIssueCode(compilation) ?? null,
      selectedQuestion: dialogue.status === 'ask_question' ? dialogue.question : null,
      authorization: {
        planningIntent,
        semanticChanged,
        previousDraftGenerationIntent,
        criterion: 'create_plan OR durable user_authorized before draft_ready OR (draft_ready + update_plan + semanticChanged)',
        authorized,
      },
    },
  });

  if (dialogue.status === 'ask_question') {
    const message = groundedMessage({
      message: renderStableV5RuntimeQuestion(semantic.graph, dialogue.question),
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
      authorized,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'ask_question',
      basis: {
        dialogue,
        renderedQuestion: message,
        issueLabel: stableV5IssueTaskLabel(semantic.graph, dialogue.question),
        groundingRecords,
        repairDecision,
      },
      output,
      severity: 'warn',
    });
    return output;
  }

  if (dialogue.status === 'nothing_to_schedule' || !compilation.input) {
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
      authorized,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'nothing_to_schedule',
      basis: {
        dialogueStatus: dialogue.status,
        compilationStatus: compilation.status,
        compilationInputExists: Boolean(compilation.input),
        recognizedTaskTitles: missingWork.taskTitles,
        questionCode: missingWork.questionCode,
        groundingRecords,
        repairDecision,
      },
      output,
      severity: 'warn',
    });
    return output;
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
    return output;
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
    return output;
  }

  const preview = executeWeeklyPlanningStableV5Preview({
    input,
    graph: semantic.graph,
    schedulerInput: compilation.input,
    requestContext,
  });

  if (preview.status === 'insufficient_capacity') {
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
    const message = groundedMessage({
      message: '固定予定は把握しましたが、新しく配置する作業がありません。予定に入れたい作業を教えてください。',
      records: groundingRecords,
      currentTurnId: input.traceRequestId,
    });
    const output = projectStableV5CompatibilityOutput({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: [],
      authorized: true,
      groundingRecords,
      repairAgenda: repairDecision.agenda,
    });
    traceRuntimeBranch({
      requestId: input.traceRequestId,
      branch: 'preview_empty',
      basis: { preview, groundingRecords, repairDecision },
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

export function getWeeklyPlanningStableV5BlockingIssueCode(
  compilation: GenericSchedulerInputCompilationResult,
): string | undefined {
  return stableV5BlockingIssueCode(compilation);
}
