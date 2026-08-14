import { getAiConfig } from '../../../lib/aiConfig';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  type WeeklyPlanningStableV5DialogueActionKind,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';
import {
  isStableV5QuestionLikeText,
  requiredLabelsForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';
import {
  shouldUseAiWeeklyPlanningStableV5DialogueRenderer,
} from './weeklyPlanningStableV5DialogueRouting';
import {
  createWeeklyPlanningAiRenderedDialogueTrace,
  createWeeklyPlanningDeterministicQuestionDialogueTrace,
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

const RECENT_TURN_LIMIT = 6;
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
  if (result.state.questions.length > 0 || isStableV5QuestionLikeText(result.message)) {
    return 'question';
  }
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

function deterministicQuestionBypass(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
  notice: string | null;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  actionId: string;
}): WeeklyPlanningTurnExecutionResult {
  const finalMessage = withSelfRepairNotice(params.result.message, params.notice);
  const dialogueRendererTrace = createWeeklyPlanningDeterministicQuestionDialogueTrace({
    actionId: params.actionId,
    actionKind: params.actionKind,
    questionCode: params.questionCode,
    finalMessage,
  });
  const result = withAssistantMessage({
    result: params.result,
    message: finalMessage,
    responseSource: 'rules',
    dialogueRendererTrace,
  });
  recordWeeklyPlanningDialogueDecisionV5({
    requestId: params.input.traceRequestId,
    branch: 'deterministic_question_bypass',
    actionId: params.actionId,
    questionCode: params.questionCode,
    responseSource: result.responseSource,
    message: result.message,
    selfRepairNotice: params.notice,
  });
  return result;
}

function createRenderInput(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
  notice: string | null;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  actionId: string;
}): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: params.actionId,
    currentUserMessage: params.input.userText,
    recentConversation: params.input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    planningInformation: params.result.stableV5Graph
      ? {
          ...createWeeklyPlanningStableV5DialogueProjection(params.result.stableV5Graph),
          selfRepairNotice: params.notice,
        }
      : null,
    actionKind: params.actionKind,
    questionCode: params.questionCode,
    requiredLabels: requiredLabelsForStableV5Dialogue({
      questionCode: params.questionCode,
      fallbackText: params.result.message,
    }),
    fallbackText: withSelfRepairNotice(params.result.message, params.notice),
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

  if (!shouldUseAiWeeklyPlanningStableV5DialogueRenderer({
    actionKind,
    questionCode: currentQuestionCode,
    currentUserMessage: params.input.userText,
  })) {
    return deterministicQuestionBypass({
      ...params,
      notice,
      actionKind,
      questionCode: currentQuestionCode,
      actionId: currentActionId,
    });
  }

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

  // The renderer already receives the correction in both planningInformation and
  // fallbackText, so its successful response owns the complete user-facing copy.
  // Prefixing the deterministic notice here repeats the same acknowledgement and
  // can produce an ungrammatical transition. The fallback paths still retain the
  // exact deterministic notice when rendering is unavailable or rejected.
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
