import { getAiConfig } from '../../../lib/aiConfig';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  type WeeklyPlanningStableV5DialogueActionKind,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';
import type {
  WeeklyPlanningStableV5DialogueQuestionIntent,
} from './weeklyPlanningStableV5DialogueContracts';
import {
  learningStrategyProposalIntentForStableV5Dialogue,
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  requiredLabelsForStableV5Dialogue,
  WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL,
} from './weeklyPlanningStableV5DialogueContext';
import {
  createWeeklyPlanningAiRenderedDialogueTrace,
  createWeeklyPlanningFallbackDialogueTrace,
  createWeeklyPlanningSystemDialogueRendererTrace,
  recordWeeklyPlanningDialogueDecisionV5,
  recordWeeklyPlanningDialogueRendererRequestV5,
  recordWeeklyPlanningDialogueRendererResponseV5,
} from './weeklyPlanningStableV5TurnDialogueTrace';
import {
  createWeeklyPlanningSelfRepairNoticeV5,
} from '../semantic/weeklyPlanningSelfRepairV5';
import {
  createWeeklyPlanningStableV5DialogueProjection,
} from '../semantic/weeklyPlanningStableV5DialogueProjection';
import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutionTypes';

export { createWeeklyPlanningSystemDialogueRendererTrace } from './weeklyPlanningStableV5TurnDialogueTrace';

const RECENT_TURN_LIMIT = 4;
const STABLE_V5_SYSTEM_MESSAGE_PREFIXES = [
  'AIに接続できなかったため',
  '入力内容は保持していますが、予定条件の構造化処理に失敗しました',
  '直前の会話状態とAIの構造化結果が一致しなかったため',
  '同じ送信はすでに処理済みのため',
] as const;

function questionCode(result: WeeklyPlanningTurnExecutionResult): string | null {
  const targetSlot = result.state.lastQuestionContext?.targetSlot;
  return targetSlot?.startsWith('stable_v5:')
    ? targetSlot.slice('stable_v5:'.length)
    : null;
}

function dialogueActionKind(
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningStableV5DialogueActionKind {
  if (result.draftCandidates.length > 0) return 'preview_ready';
  if (questionCode(result)) return 'question';
  return 'status';
}

function isSystemResult(result: WeeklyPlanningTurnExecutionResult): boolean {
  return Boolean(result.failure)
    || result.responseSource === 'system'
    || STABLE_V5_SYSTEM_MESSAGE_PREFIXES.some((prefix) => result.message.startsWith(prefix));
}

function selfRepairNotice(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
}): string | null {
  if (!params.result.stableV5Graph) return null;
  return createWeeklyPlanningSelfRepairNoticeV5({
    graph: params.result.stableV5Graph,
    currentTurnId: params.input.traceRequestId,
  })?.message ?? null;
}

function withSelfRepairNotice(message: string, notice: string | null): string {
  if (!notice || message.includes(notice)) return message;
  return `${notice} ${message}`;
}

function actionId(params: {
  traceRequestId: string;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
}): string {
  return [
    'stable-v5',
    params.traceRequestId,
    params.questionCode ?? params.actionKind,
  ].join(':');
}

function withAssistantMessage(params: {
  result: WeeklyPlanningTurnExecutionResult;
  message: string;
  responseSource: 'ai' | 'deterministic_fallback' | 'rules' | 'system';
  dialogueRendererTrace: WeeklyPlanningDialogueRendererTrace;
}): WeeklyPlanningTurnExecutionResult {
  const state = params.result.state.questions.length > 0
    ? { ...params.result.state, questions: [params.message] }
    : params.result.state;
  return {
    ...params.result,
    state,
    message: params.message,
    responseSource: params.responseSource,
    dialogueRendererTrace: params.dialogueRendererTrace,
  };
}

function groundingRecords(
  result: WeeklyPlanningTurnExecutionResult,
): Array<Record<string, unknown>> {
  return (result.state.groundingRecords ?? []).map((record) => ({
    targetFactId: record.targetFactId,
    interpretationKind: record.interpretationKind,
    status: record.status,
    sourceExpression: record.sourceExpression,
    startDate: record.startDate,
    endDate: record.endDate,
  }));
}

function effortFallbackText(
  intent: Extract<WeeklyPlanningStableV5DialogueQuestionIntent, { kind: 'effort_measurement' }>,
): string {
  if (intent.measurement === 'session_duration') {
    return '1回の学習時間を教えてください。';
  }
  if (intent.measurement === 'duration_per_unit') {
    const unit = intent.unitLabel?.trim();
    return unit
      ? `1${unit}あたりどれくらい時間がかかりますか？`
      : '1単位あたりどれくらい時間がかかりますか？';
  }
  if (intent.quantityRole === 'completed' && intent.unitLabel?.trim()) {
    return `完了した${intent.amount}${intent.unitLabel.trim()}には、合計でどれくらい時間がかかりましたか？`;
  }
  return '指定した量を進めるのに、合計でどれくらい時間がかかりますか？';
}

export function fallbackTextForStableV5TypedIntent(params: {
  applicationText: string;
  questionIntent: WeeklyPlanningStableV5DialogueQuestionIntent | null | undefined;
}): string {
  const intent = params.questionIntent;
  if (intent?.kind === 'learning_strategy_proposal') {
    const min = intent.suggestedSessionDurationMinutes.min;
    const max = intent.suggestedSessionDurationMinutes.max;
    if (intent.proposalKind === 'calibrate_memory_pace') {
      const minutes = intent.selectedSessionDurationMinutes ?? min;
      return `学習ペース計測の提案（${minutes}分）について、採用するか教えてください。`;
    }
    return `分散学習の提案（1回${min}〜${max}分）について、採用するか教えてください。`;
  }
  if (intent?.kind === 'effort_measurement') {
    return effortFallbackText(intent);
  }
  return params.applicationText;
}

function createRenderInput(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
  notice: string | null;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  actionId: string;
}): WeeklyPlanningStableV5DialogueRenderInput {
  const planningInformation = params.result.stableV5Graph
    ? {
        ...createWeeklyPlanningStableV5DialogueProjection(params.result.stableV5Graph),
        groundingRecords: groundingRecords(params.result),
        selfRepairNotice: params.notice,
      }
    : null;
  const targetFactId = params.result.state.lastQuestionContext?.topicId ?? null;
  const questionTarget = questionTargetForStableV5Dialogue({
    planningInformation,
    targetFactId,
  });
  const proposalIntent = learningStrategyProposalIntentForStableV5Dialogue({
    questionCode: params.questionCode,
    actionId: params.result.state.lastQuestionContext?.actionId ?? null,
    proposalRecords: params.result.state.learningStrategyProposalRecords ?? [],
  });
  const questionIntent = proposalIntent ?? questionIntentForStableV5Dialogue({
    questionCode: params.questionCode,
    questionTarget,
    effortMeasurement: params.result.state.lastQuestionContext?.intent ?? null,
  });
  const previewPromotionControlLabel = params.result.state.status === 'draft_ready'
    ? WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL
    : null;
  const fallbackText = fallbackTextForStableV5TypedIntent({
    applicationText: params.result.message,
    questionIntent,
  });
  return {
    actionId: params.actionId,
    currentUserMessage: params.input.userText,
    recentConversation: params.input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    planningInformation,
    actionKind: params.actionKind,
    questionCode: params.questionCode,
    questionTarget,
    questionIntent,
    previewPromotionControlLabel,
    requiredLabels: requiredLabelsForStableV5Dialogue({
      planningInformation,
      targetFactId,
      includePreviewPromotionControl: previewPromotionControlLabel !== null,
    }),
    fallbackText: withSelfRepairNotice(fallbackText, params.notice),
    previewCount: params.result.draftCandidates.length,
  };
}

export async function renderWeeklyPlanningStableV5AssistantMessage(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
}): Promise<WeeklyPlanningTurnExecutionResult> {
  if (isSystemResult(params.result)) {
    const dialogueRendererTrace = createWeeklyPlanningSystemDialogueRendererTrace(
      params.result.message,
    );
    const result = withAssistantMessage({
      result: params.result,
      message: params.result.message,
      responseSource: 'system',
      dialogueRendererTrace,
    });
    recordWeeklyPlanningDialogueDecisionV5({
      requestId: params.input.traceRequestId,
      branch: 'system_message_bypass',
      responseSource: result.responseSource,
      message: result.message,
    });
    return result;
  }

  const notice = selfRepairNotice(params);
  const actionKind = dialogueActionKind(params.result);
  const currentQuestionCode = questionCode(params.result);
  const currentActionId = actionId({
    traceRequestId: params.input.traceRequestId,
    actionKind,
    questionCode: currentQuestionCode,
  });
  const renderInput = createRenderInput({
    ...params,
    notice,
    actionKind,
    questionCode: currentQuestionCode,
    actionId: currentActionId,
  });
  recordWeeklyPlanningDialogueRendererRequestV5({
    requestId: params.input.traceRequestId,
    input: renderInput,
  });

  const rendered = await createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig()).render(
    renderInput,
  );
  recordWeeklyPlanningDialogueRendererResponseV5({
    requestId: params.input.traceRequestId,
    actionId: currentActionId,
    rendered,
    selfRepairNotice: notice,
  });

  if (rendered.status === 'fallback') {
    const finalMessage = renderInput.fallbackText;
    const dialogueRendererTrace = createWeeklyPlanningFallbackDialogueTrace({
      actionId: currentActionId,
      actionKind,
      questionCode: currentQuestionCode,
      renderInput,
      rendered,
      finalMessage,
    });
    const result = withAssistantMessage({
      result: params.result,
      message: finalMessage,
      responseSource: 'deterministic_fallback',
      dialogueRendererTrace,
    });
    recordWeeklyPlanningDialogueDecisionV5({
      requestId: params.input.traceRequestId,
      branch: 'deterministic_fallback',
      actionId: currentActionId,
      reason: rendered.reason,
      responseSource: result.responseSource,
      message: result.message,
      selfRepairNotice: notice,
      severity: 'warn',
    });
    return result;
  }

  const finalMessage = rendered.text;
  const dialogueRendererTrace = createWeeklyPlanningAiRenderedDialogueTrace({
    actionId: currentActionId,
    actionKind,
    questionCode: currentQuestionCode,
    renderInput,
    rendered,
    finalMessage,
  });
  const result = withAssistantMessage({
    result: params.result,
    message: finalMessage,
    responseSource: 'ai',
    dialogueRendererTrace,
  });
  recordWeeklyPlanningDialogueDecisionV5({
    requestId: params.input.traceRequestId,
    branch: 'ai_rendered',
    actionId: currentActionId,
    responseSource: result.responseSource,
    message: result.message,
    selfRepairNotice: notice,
    preservedQuestionContext: result.state.lastQuestionContext ?? null,
  });
  return result;
}
