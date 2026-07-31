import { getAiConfig, getAiConfigValidationMessage } from '../../lib/aiConfig';
import type { Plan, ScheduleTemplate } from '../../types/domain';
import {
  isWeeklyPlanningStableV5RuntimeEnabled,
} from './application/weeklyPlanningRuntimeMode';
import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { createAiWeeklyPlanningDialogueRenderer } from './dialogue/weeklyPlanningAiDialogueRenderer';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  type WeeklyPlanningStableV5DialogueActionKind,
} from './dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import {
  isStableV5QuestionLikeText,
  requiredLabelsForStableV5Dialogue,
} from './dialogue/weeklyPlanningStableV5DialogueContext';
import { renderWeeklyPlanningDialogueMessage } from './dialogue/weeklyPlanningDialogueRenderer';
import { createAiWeeklyPlanningInterpreter } from './intake/weeklyPlanningAiInterpreter';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import {
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from './pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { WeeklyPlanningWeekStartsOn } from './personalization/weeklyPlanningWeek';
import { WeeklyPlanningSemanticInterpreterError } from './pipeline/weeklyPlanningSemanticInterpreterError';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import {
  takeWeeklyPlanningStableV5FailureDiagnostics,
} from './semantic/weeklyPlanningStableV5FailureDiagnostics';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from './trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningDialogueRendererTrace } from './trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningTraceResponseSource } from './trace/weeklyPlanningTraceTypes';
import type { WeeklyPlanningMessage } from './types';

const RECENT_TURN_LIMIT = 6;
const STABLE_V5_SYSTEM_MESSAGE_PREFIXES = [
  'AIに接続できなかったため',
  '入力内容は保持していますが、予定条件の構造化処理に失敗しました',
  '直前の会話状態とAIの構造化結果が一致しなかったため',
  '同じ送信はすでに処理済みのため',
] as const;

export interface WeeklyPlanningTurnExecutionInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  conversationId: string;
  traceRequestId: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
}

export type WeeklyPlanningTurnFailureCode =
  | 'stable_v5_provider_failure'
  | 'stable_v5_normalization_rejected'
  | 'stable_v5_canonicalization_rejected';

export interface WeeklyPlanningTurnFailureDiagnostics {
  attemptCount: number;
  repairAttempted: boolean;
  validationErrorCategories: string[];
  providerErrorCategory: 'provider_error' | null;
}

export interface WeeklyPlanningTurnFailure {
  code: WeeklyPlanningTurnFailureCode;
  userMessage: string;
  traceCode: string;
  diagnostics: WeeklyPlanningTurnFailureDiagnostics;
}

export interface WeeklyPlanningTurnExecutionResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
  stableV5Graph?: WeeklyPlanningFactGraphV5;
  failure?: WeeklyPlanningTurnFailure;
  responseSource?: WeeklyPlanningTraceResponseSource;
  dialogueRendererTrace?: WeeklyPlanningDialogueRendererTrace;
}

export interface WeeklyPlanningTurnSubmissionResult {
  accepted: boolean;
  draftCandidates: WeeklyDraftCandidate[];
}

function stableV5QuestionCode(state: PlanningIntakeState): string | null {
  const targetSlot = state.lastQuestionContext?.targetSlot;
  return targetSlot?.startsWith('stable_v5:')
    ? targetSlot.slice('stable_v5:'.length)
    : null;
}

function stableV5DialogueActionKind(
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningStableV5DialogueActionKind {
  if (result.draftCandidates.length > 0) return 'preview_ready';
  if (result.state.questions.length > 0 || isStableV5QuestionLikeText(result.message)) {
    return 'question';
  }
  return 'status';
}

function isStableV5SystemResult(result: WeeklyPlanningTurnExecutionResult): boolean {
  return Boolean(result.failure)
    || result.responseSource === 'system'
    || STABLE_V5_SYSTEM_MESSAGE_PREFIXES.some((prefix) => result.message.startsWith(prefix));
}

function stableV5PlanningInformation(
  graph: WeeklyPlanningFactGraphV5 | undefined,
): Record<string, unknown> | null {
  if (!graph) return null;

  return {
    revision: graph.revision,
    planningWindows: graph.planningWindows.map((fact) => ({
      kind: fact.kind,
      value: fact.value,
      start: fact.start,
      end: fact.end,
    })),
    tasks: graph.tasks.map((fact) => ({
      id: fact.id,
      category: fact.category,
      title: fact.title,
    })),
    studyContexts: graph.studyContexts.map((fact) => ({
      taskId: fact.taskId,
      purpose: fact.purpose,
      contextLabel: fact.contextLabel,
    })),
    components: graph.components.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      parentComponentId: fact.parentComponentId,
      role: fact.role,
      label: fact.label,
    })),
    workloads: graph.workloads.map((fact) => ({
      taskId: fact.taskId,
      componentId: fact.componentId,
      quantityRole: fact.quantityRole,
      amount: fact.amount,
      unitCode: fact.unitCode,
      unitLabel: fact.unitLabel,
      rangeStart: fact.rangeStart,
      rangeEnd: fact.rangeEnd,
      perOccurrence: fact.perOccurrence,
      periodExpression: fact.periodExpression,
    })),
    effortEstimates: graph.effortEstimates.map((fact) => ({
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      minutes: fact.minutes,
      unitCode: fact.unitCode,
      precision: fact.precision,
    })),
    temporalConstraints: graph.temporalConstraints.map((fact) => ({
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      constraintLevel: fact.constraintLevel,
      dateExpression: fact.dateExpression,
      namedTimePeriod: fact.namedTimePeriod,
      startTime: fact.startTime,
      endTime: fact.endTime,
      precision: fact.precision,
    })),
    taskDateRules: graph.taskDateRules.map((fact) => ({
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      dateExpression: fact.dateExpression,
      constraintLevel: fact.constraintLevel,
    })),
    recurrences: graph.recurrences.map((fact) => ({
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      count: fact.count,
      days: fact.days,
    })),
    relations: graph.relations.map((fact) => ({
      kind: fact.kind,
      fromTaskId: fact.fromTaskId,
      toTaskId: fact.toTaskId,
    })),
    uncertainties: graph.uncertainties.map((fact) => ({
      targetFactId: fact.targetFactId,
      field: fact.field,
      reason: fact.reason,
    })),
    availabilityDeclarations: graph.availabilityDeclarations.map((fact) => ({
      kind: fact.kind,
      dateExpression: fact.dateExpression,
      namedTimePeriod: fact.namedTimePeriod,
      startTime: fact.startTime,
      endTime: fact.endTime,
      recurrenceKind: fact.recurrenceKind,
      days: fact.days,
      constraintLevel: fact.constraintLevel,
      resolutionStatus: fact.resolutionStatus,
    })),
    constraintSourceRequests: graph.constraintSourceRequests.map((fact) => ({
      kind: fact.kind,
      selector: fact.selector,
      requestedAction: fact.requestedAction,
      resolutionStatus: fact.resolutionStatus,
    })),
  };
}

function systemDialogueRendererTrace(message: string): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: null,
    actionKind: null,
    questionCode: null,
    request: null,
    response: {
      status: 'bypassed',
      reason: 'system_message',
      rawResponse: null,
      renderedText: null,
    },
    decision: {
      branch: 'system_message_bypass',
      responseSource: 'system',
      finalMessage: message,
    },
  };
}

async function renderStableV5AssistantMessage(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
}): Promise<WeeklyPlanningTurnExecutionResult> {
  if (isStableV5SystemResult(params.result)) {
    const dialogueRendererTrace = systemDialogueRendererTrace(params.result.message);
    const result = {
      ...params.result,
      responseSource: 'system' as const,
      dialogueRendererTrace,
    };
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.input.traceRequestId,
      stage: 'dialogue_renderer_decision',
      data: {
        branch: 'system_message_bypass',
        responseSource: result.responseSource,
        message: result.message,
      },
    });
    return result;
  }

  const actionKind = stableV5DialogueActionKind(params.result);
  const questionCode = stableV5QuestionCode(params.result.state);
  const actionId = [
    'stable-v5',
    params.input.traceRequestId,
    questionCode ?? actionKind,
  ].join(':');
  const renderInput = {
    actionId,
    currentUserMessage: params.input.userText,
    recentConversation: params.input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    planningInformation: stableV5PlanningInformation(params.result.stableV5Graph),
    actionKind,
    questionCode,
    requiredLabels: requiredLabelsForStableV5Dialogue({
      questionCode,
      fallbackText: params.result.message,
    }),
    fallbackText: params.result.message,
    previewCount: params.result.draftCandidates.length,
  } as const;
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'dialogue_renderer_request',
    data: {
      purpose: 'weekly_planning_renderer',
      input: renderInput,
    },
  });

  const rendered = await createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig()).render(
    renderInput,
  );
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'dialogue_renderer_response',
    severity: rendered.status === 'rendered' ? 'info' : 'warn',
    data: {
      actionId,
      status: rendered.status,
      reason: rendered.status === 'fallback' ? rendered.reason : null,
      rawResponse: rendered.rawResponse,
    },
  });

  if (rendered.status === 'fallback') {
    const dialogueRendererTrace: WeeklyPlanningDialogueRendererTrace = {
      actionId,
      actionKind,
      questionCode,
      request: {
        purpose: 'weekly_planning_renderer',
        requiredLabels: [...renderInput.requiredLabels],
        fallbackText: renderInput.fallbackText,
        previewCount: renderInput.previewCount,
      },
      response: {
        status: 'fallback',
        reason: rendered.reason,
        rawResponse: rendered.rawResponse,
        renderedText: null,
      },
      decision: {
        branch: 'deterministic_fallback',
        responseSource: 'deterministic_fallback',
        finalMessage: params.result.message,
      },
    };
    const result = {
      ...params.result,
      responseSource: 'deterministic_fallback' as const,
      dialogueRendererTrace,
    };
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.input.traceRequestId,
      stage: 'dialogue_renderer_decision',
      severity: 'warn',
      data: {
        branch: 'deterministic_fallback',
        actionId,
        reason: rendered.reason,
        responseSource: result.responseSource,
        message: result.message,
      },
    });
    return result;
  }

  const state = params.result.state.questions.length > 0
    ? { ...params.result.state, questions: [rendered.text] }
    : params.result.state;
  const dialogueRendererTrace: WeeklyPlanningDialogueRendererTrace = {
    actionId,
    actionKind,
    questionCode,
    request: {
      purpose: 'weekly_planning_renderer',
      requiredLabels: [...renderInput.requiredLabels],
      fallbackText: renderInput.fallbackText,
      previewCount: renderInput.previewCount,
    },
    response: {
      status: 'rendered',
      reason: null,
      rawResponse: rendered.rawResponse,
      renderedText: rendered.text,
    },
    decision: {
      branch: 'ai_rendered',
      responseSource: 'ai',
      finalMessage: rendered.text,
    },
  };
  const result = {
    ...params.result,
    state,
    message: rendered.text,
    responseSource: 'ai' as const,
    dialogueRendererTrace,
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'dialogue_renderer_decision',
    data: {
      branch: 'ai_rendered',
      actionId,
      responseSource: result.responseSource,
      message: result.message,
      preservedQuestionContext: result.state.lastQuestionContext ?? null,
    },
  });
  return result;
}

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  if (isWeeklyPlanningStableV5RuntimeEnabled()) {
    takeWeeklyPlanningStableV5FailureDiagnostics(input.traceRequestId);
    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: input.previousState,
      messages: input.messages,
      userText: input.userText,
      selectedDate: input.selectedDate,
      userId: input.userId,
      plans: input.plans,
      scheduleTemplates: input.scheduleTemplates,
      timetableTermId: input.timetableTermId,
      conversationId: input.conversationId,
      traceRequestId: input.traceRequestId,
    });
    const recordedFailure = takeWeeklyPlanningStableV5FailureDiagnostics(input.traceRequestId);
    if (!recordedFailure) {
      const renderedResult = await renderStableV5AssistantMessage({ input, result });
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'turn_executor_result_projected',
        data: {
          branch: 'no_recorded_failure',
          criteria: 'failure diagnostics repository returned null',
          projectedResult: renderedResult,
        },
      });
      return renderedResult;
    }

    const failureCode = `stable_v5_${recordedFailure.status}` as WeeklyPlanningTurnFailureCode;
    const projected: WeeklyPlanningTurnExecutionResult = {
      ...result,
      state: {
        ...result.state,
        status: 'revision_pending',
        missing: [],
        questions: [],
        lastQuestionContext: undefined,
        shouldCreateDraft: false,
        draftGenerationIntent: 'not_requested',
      },
      failure: {
        code: failureCode,
        userMessage: result.message,
        traceCode: recordedFailure.traceCode,
        diagnostics: {
          attemptCount: recordedFailure.attemptCount,
          repairAttempted: recordedFailure.repairAttempted,
          validationErrorCategories: recordedFailure.validationErrorCategories,
          providerErrorCategory: recordedFailure.providerErrorCategory,
        },
      },
      responseSource: 'system',
      dialogueRendererTrace: systemDialogueRendererTrace(result.message),
    };
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'turn_executor_result_projected',
      severity: 'error',
      data: {
        branch: 'recorded_failure_projected',
        criteria: {
          recordedFailureExists: true,
          projectedStatus: 'revision_pending',
          questionsCleared: true,
          draftAuthorizationCleared: true,
        },
        recordedFailure,
        originalResult: result,
        projectedResult: projected,
      },
    });
    return projected;
  }

  const pipelineInput = {
    previousState: input.previousState,
    recentTurns: input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    userText: input.userText,
    planningStartDate: input.selectedDate,
    planningDayCount: 7,
    sessionPolicy: {
      firstDayStartTime: '09:00',
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 10,
    },
    existingPlans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    weekStartsOn: input.weekStartsOn,
  };
  const aiConfig = getAiConfig();
  const aiConfigError = getAiConfigValidationMessage(aiConfig);
  if (aiConfig.provider === 'rules' || aiConfigError) {
    throw new WeeklyPlanningSemanticInterpreterError(
      'interpreter_unavailable',
      aiConfigError ?? 'rules provider is not permitted for weekly-planning interpretation',
    );
  }
  const pipelineOutput = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
    ...pipelineInput,
    interpreter: createAiWeeklyPlanningInterpreter(aiConfig),
  }, {
    useAiDialoguePlanner: true,
    userId: input.userId,
    conversationId: input.conversationId,
    traceRequestId: input.traceRequestId,
  });
  const isExamFlow = Boolean(pipelineOutput.state.examPrepScope);
  const semanticInterpretationSuppressed = pipelineOutput.interpretationOutcome === 'failed'
    || pipelineOutput.interpretationOutcome === 'rejected';
  const shouldRenderExamDialogue = isExamFlow && !semanticInterpretationSuppressed;
  const dialogueRenderer = shouldRenderExamDialogue
    ? createAiWeeklyPlanningDialogueRenderer(aiConfig)
    : undefined;
  const message = shouldRenderExamDialogue
    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      previousState: input.previousState,
      decision: pipelineOutput.decision,
      renderer: dialogueRenderer,
      userId: input.userId,
      existingPlans: input.plans,
    })
    : pipelineOutput.behaviorDialogue.message;
  const firstRenderedQuestion = shouldRenderExamDialogue
    ? pipelineOutput.decision.questionPlan?.[0]
    : undefined;
  const state: PlanningIntakeState = firstRenderedQuestion
    ? {
        ...pipelineOutput.state,
        lastQuestionContext: {
          kind: pipelineOutput.decision.kind === 'offer_dry_run_preview' ? 'preview' : 'missing',
          targetSlot: firstRenderedQuestion.targetSlot,
          intent: firstRenderedQuestion.intent,
        },
      }
    : pipelineOutput.state;

  return {
    state,
    message,
    draftCandidates: pipelineOutput.draftCandidates ?? [],
  };
}
