import { getAiConfig, getAiConfigValidationMessage } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  stageUserPlanningContextFactsV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  collectUserPlanningContextFactsV5,
} from '../semantic/weeklyPlanningDurableContextSignalsV5';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  reconcileWeeklyPlanningGroundingRecordsV5,
} from '../semantic/weeklyPlanningGroundingV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from '../semantic/weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from '../semantic/weeklyPlanningSemanticPipelineV5';
import {
  decideWeeklyPlanningStableDialogueV5,
} from '../semantic/weeklyPlanningStableDialoguePolicyV5';
import {
  decideWeeklyPlanningStableRepairPolicyV5,
} from '../semantic/weeklyPlanningStableRepairPolicyV5';
import {
  scheduleWeeklyPlanningStableV5Preview,
  WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
} from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  projectStableV5CompatibilityOutput,
} from './weeklyPlanningStableV5CompatibilityState';
import {
  createStableV5ExternalConstraintSources,
} from './weeklyPlanningStableV5ExternalSources';
import {
  stableV5RelevantContinuationAccepted,
  withStableV5GroundingProposal,
} from './weeklyPlanningStableV5GroundingFlow';
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
  createStableV5SemanticPublicStateSummary,
  stableV5RequestContextForInput,
  STABLE_V5_RECENT_TURN_LIMIT,
} from './weeklyPlanningStableV5SemanticContext';
import {
  createWeeklyPlanningSchedulerContext,
  resolveWeeklyPlanningPlanningHorizon,
} from './weeklyPlanningTemporalContext';
import {
  commitWeeklyPlanningStableV5RuntimeGraph,
  getOrCreateWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

export type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';

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

function semanticFailureOutput(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  branch: 'provider_failure' | 'normalization_rejected' | 'canonicalization_rejected';
  message: string;
  basis: unknown;
}): WeeklyPlanningTurnExecutionResult {
  const output = projectStableV5CompatibilityOutput({
    previousState: params.input.previousState,
    userText: params.input.userText,
    message: params.message,
    draftCandidates: [],
    authorized: false,
  });
  traceRuntimeBranch({
    requestId: params.input.traceRequestId,
    branch: params.branch,
    basis: params.basis,
    output,
    severity: 'error',
  });
  return output;
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
  const aiConfig = getAiConfig();
  const configError = getAiConfigValidationMessage(aiConfig);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_configuration_evaluated',
    severity: aiConfig.provider === 'rules' || configError ? 'error' : 'info',
    data: {
      provider: aiConfig.provider,
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
      configError,
      criteria: {
        rulesProviderRejected: true,
        validConfigurationRequired: true,
      },
    },
  });
  if (aiConfig.provider === 'rules' || configError) {
    throw new Error(configError ?? 'Stable V5にはAI structured output接続が必要です。');
  }

  const temporal = stableV5RequestContextForInput(input);
  const requestContext = temporal.context;
  const runtimeSession = getOrCreateWeeklyPlanningStableV5RuntimeSession({
    ownerId: input.userId,
    conversationId: input.conversationId,
  });
  const activeWindowsBefore = activeStableV5PlanningWindows(runtimeSession.graph);
  const fallbackHorizon = resolveWeeklyPlanningPlanningHorizon({
    graph: runtimeSession.graph,
    selectedDate: input.selectedDate,
    requestContext,
    groundingRecords: input.previousState?.groundingRecords,
  });
  const recentConversation = input.messages
    .slice(-STABLE_V5_RECENT_TURN_LIMIT)
    .map(({ role, content }) => ({ role, content }));
  const stateSummary = createStableV5SemanticPublicStateSummary({
    graph: runtimeSession.graph,
    messages: input.messages,
    previousState: input.previousState,
    ownerId: input.userId,
    currentDate: requestContext.currentDate,
  });
  const initialSchedulerContext = createWeeklyPlanningSchedulerContext({
    ownerId: input.userId,
    horizon: fallbackHorizon,
    requestContext,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_session_context_prepared',
    data: {
      runtimeSession,
      graphRevision: runtimeSession.graph.revision,
      activePlanningWindows: activeWindowsBefore,
      selectedDate: input.selectedDate,
      requestContext,
      requestContextSource: temporal.source,
      fallbackHorizon,
      horizonCriteria: {
        moreThanOneActiveWindow: 'return null',
        noActiveWindow: 'selectedDate is display/fallback seed only',
        explicitStartEnd: 'valid dates and start <= end',
        groundedRelativeWindow: 'reuse the persisted absolute grounding range until the source fact is corrected',
        otherwise: 'resolveCanonicalDateExpression(window.value, requestContext.currentDate, weekStartsOn)',
      },
      recentTurnLimit: STABLE_V5_RECENT_TURN_LIMIT,
      recentConversation,
      publicStateSummary: stateSummary,
      schedulerContext: initialSchedulerContext,
    },
  });

  const semantic = await createWeeklyPlanningSemanticPipelineV5(
    createWeeklyPlanningSemanticNormalizerV5(createOpenAiCompatibleClient(aiConfig)),
  ).run({
    graph: runtimeSession.graph,
    conversationId: input.conversationId,
    turnId: input.traceRequestId,
    expectedRevision: runtimeSession.graph.revision,
    userText: input.userText,
    recentConversation,
    publicStateSummary: stateSummary,
    schedulerContext: initialSchedulerContext,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_semantic_result_received',
    severity: semantic.status === 'normalization_rejected'
      || semantic.status === 'provider_failure'
      || semantic.status === 'canonicalization_rejected'
      ? 'error'
      : 'info',
    data: semantic,
  });

  if (semantic.status === 'provider_failure') {
    return semanticFailureOutput({
      input,
      branch: 'provider_failure',
      message: 'AIに接続できなかったため、入力内容は変更していません。接続を確認してもう一度送ってください。',
      basis: { semanticStatus: semantic.status },
    });
  }
  if (semantic.status === 'normalization_rejected') {
    return semanticFailureOutput({
      input,
      branch: 'normalization_rejected',
      message: 'こちらの処理で内容を安全に整理できなかったため、予定条件には反映していません。まず、いつの予定を作るか、または何を進めるかを一つだけ教えてください。',
      basis: { semanticStatus: semantic.status, normalization: semantic.normalization },
    });
  }
  if (semantic.status === 'canonicalization_rejected') {
    return semanticFailureOutput({
      input,
      branch: 'canonicalization_rejected',
      message: '直前の会話状態と構造化結果が一致しなかったため、変更は反映していません。直前に確認していた項目だけ、短く一つ教えてください。',
      basis: {
        semanticStatus: semantic.status,
        expectedRevision: runtimeSession.graph.revision,
        actualInputGraphRevision: runtimeSession.graph.revision,
        canonicalization: semantic.canonicalization,
      },
    });
  }

  const userContextFacts = semantic.normalization.document
    ? collectUserPlanningContextFactsV5(semantic.normalization.document)
    : [];
  stageUserPlanningContextFactsV1({
    ownerId: input.userId,
    conversationId: input.conversationId,
    requestId: input.traceRequestId,
    observedDate: requestContext.currentDate,
    facts: userContextFacts,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_user_context_staged',
    data: {
      ownerId: input.userId,
      conversationId: input.conversationId,
      requestId: input.traceRequestId,
      observedDate: requestContext.currentDate,
      userContextFacts,
    },
  });

  commitWeeklyPlanningStableV5RuntimeGraph({
    ownerId: input.userId,
    conversationId: input.conversationId,
    graph: semantic.graph,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_graph_staged',
    data: {
      ownerId: input.userId,
      conversationId: input.conversationId,
      requestId: input.traceRequestId,
      previousGraphRevision: runtimeSession.graph.revision,
      stagedGraph: semantic.graph,
      canonicalization: semantic.canonicalization,
    },
  });

  const semanticDiff = semantic.canonicalization?.diff ?? undefined;
  const preliminaryHorizon = resolveWeeklyPlanningPlanningHorizon({
    graph: semantic.graph,
    selectedDate: input.selectedDate,
    requestContext,
    groundingRecords: input.previousState?.groundingRecords,
  });
  const continuationAccepted = stableV5RelevantContinuationAccepted({
    previousState: input.previousState,
    diff: semanticDiff,
  });
  const groundingRecords = reconcileWeeklyPlanningGroundingRecordsV5({
    previousRecords: input.previousState?.groundingRecords ?? [],
    previousGraph: runtimeSession.graph,
    nextGraph: semantic.graph,
    resolvedHorizon: preliminaryHorizon,
    currentTurnId: input.traceRequestId,
    continuationAccepted,
  });
  const horizon = resolveWeeklyPlanningPlanningHorizon({
    graph: semantic.graph,
    selectedDate: input.selectedDate,
    requestContext,
    groundingRecords,
  });
  const schedulerContext = createWeeklyPlanningSchedulerContext({
    ownerId: input.userId,
    horizon,
    requestContext,
  });
  const externalSources = createStableV5ExternalConstraintSources({
    ownerId: input.userId,
    plans: input.plans,
    templates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    horizon,
    timeZone: requestContext.timeZone,
  });
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(semantic.graph);
  const compilation = compileGenericSchedulerInput({
    graph: activeGraph,
    context: schedulerContext,
    externalSources,
  });
  const repairDecision = decideWeeklyPlanningStableRepairPolicyV5({
    graph: semantic.graph,
    compilation,
    previousAgenda: input.previousState?.repairAgenda ?? [],
    graphRevision: semantic.graph.revision,
    turnId: input.traceRequestId,
  });
  const baselineDialogue = decideWeeklyPlanningStableDialogueV5(compilation);
  const dialogue = repairDecision.question
    ? { status: 'ask_question' as const, question: repairDecision.question }
    : baselineDialogue;
  const planningIntent = semantic.normalization.document?.planningIntent ?? null;
  const semanticChanged = Boolean(
    semanticDiff
    && (semanticDiff.added.length > 0
      || semanticDiff.superseded.length > 0
      || semanticDiff.removed.length > 0),
  );
  const previousDraftGenerationIntent = input.previousState?.draftGenerationIntent ?? null;
  const authorized = isWeeklyPlanningStableV5PreviewAuthorized({
    previousStatus: input.previousState?.status ?? null,
    previousDraftGenerationIntent,
    planningIntent,
    semanticChanged,
  });
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

  const previewInput = {
    input: compilation.input,
    graph: semantic.graph,
    plans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    notBefore: {
      date: requestContext.notBeforeDate,
      time: requestContext.notBeforeTime,
    },
  };
  const preview = scheduleWeeklyPlanningStableV5Preview(previewInput);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_preview_scheduler_evaluated',
    severity: preview.status === 'ready' ? 'info' : 'warn',
    data: {
      schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
      input: previewInput,
      defaultsAndCriteria: {
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 10,
        defaultSessionMinutes: 60,
        existingPlanBufferMinutes: 10,
        splittableThresholdMinutes: 120,
        todayNotBefore: `${requestContext.notBeforeDate} ${requestContext.notBeforeTime}`,
        allOrNothing: 'any unscheduled work item returns insufficient_capacity with no partial candidates',
      },
      result: preview,
    },
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

export function isWeeklyPlanningStableV5PreviewAuthorized(params: {
  previousStatus: PlanningIntakeState['status'] | null;
  previousDraftGenerationIntent: PlanningIntakeState['draftGenerationIntent'] | null;
  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown' | null;
  semanticChanged: boolean;
}): boolean {
  if (params.planningIntent === 'create_plan') return true;
  if (params.previousStatus === 'draft_ready') {
    return params.planningIntent === 'update_plan' && params.semanticChanged;
  }
  return params.previousDraftGenerationIntent === 'user_authorized';
}

export function getWeeklyPlanningStableV5BlockingIssueCode(
  compilation: GenericSchedulerInputCompilationResult,
): string | undefined {
  return stableV5BlockingIssueCode(compilation);
}
