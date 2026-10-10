import { getAiConfig } from '../../../lib/aiConfig';
import { getWeeklyPlanningStableV5RuntimeSession } from '../application/weeklyPlanningStableV5RuntimeSession';
import { stableV5MissingSchedulableWorkQuestion } from '../application/weeklyPlanningStableV5RuntimeQuestions';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  type WeeklyPlanningStableV5DialogueActionKind,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';
import type {
  WeeklyPlanningStableV5DialogueQuestionIntent,
} from './weeklyPlanningStableV5DialogueContracts';
import {
  decodeWeeklyPlanningStableV5QuestionSlot,
} from '../intake/weeklyPlanningStableV5QuestionSlot';
import {
  learningStrategyProposalIntentForStableV5Dialogue,
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  requiredLabelsForStableV5Dialogue,
  recoveryQuestionEvidenceForStableV5Dialogue,
  WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL,
} from './weeklyPlanningStableV5DialogueContext';
import {
  createWeeklyPlanningStableV5CurrentTurnGrounding,
} from './weeklyPlanningStableV5CurrentTurnGrounding';
import {
  createWeeklyPlanningAiRenderedDialogueTrace,
  createWeeklyPlanningFallbackDialogueTrace,
  createWeeklyPlanningSystemDialogueRendererTrace,
  recordWeeklyPlanningDialogueDecisionV5,
  recordWeeklyPlanningDialogueRendererRequestV5,
  recordWeeklyPlanningDialogueRendererResponseV5,
} from './weeklyPlanningStableV5TurnDialogueTrace';
import {
  createWeeklyPlanningRegisteredMaterialContextV5,
} from '../personalization/weeklyPlanningRegisteredMaterialRuntimeV5';
import {
  createWeeklyPlanningSelfRepairNoticeV5,
} from '../semantic/weeklyPlanningSelfRepairV5';
import {
  createWeeklyPlanningStableV5DialogueProjection,
} from '../semantic/weeklyPlanningStableV5DialogueProjection';
import type { WeeklyPlanningQuestionPresentationContent } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutionTypes';

export { createWeeklyPlanningSystemDialogueRendererTrace } from './weeklyPlanningStableV5TurnDialogueTrace';

const RECENT_TURN_LIMIT = 4;

export const WEEKLY_PLANNING_RECOVERY_TECHNICAL_STOP =
  '返信を作れませんでした。今回の内容は計画へ反映していません。少し待ってからもう一度送信してください。';

function questionCode(result: WeeklyPlanningTurnExecutionResult): string | null {
  return decodeWeeklyPlanningStableV5QuestionSlot(
    result.state.lastQuestionContext?.targetSlot,
  );
}

function questionCodeFromTargetSlot(targetSlot: string | undefined): string | null {
  return decodeWeeklyPlanningStableV5QuestionSlot(targetSlot);
}

function dialogueActionKind(
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningStableV5DialogueActionKind {
  if (result.draftCandidates.length > 0) return 'preview_ready';
  if (questionCode(result)) return 'question';
  return 'status';
}

export function isWeeklyPlanningStableV5SystemResult(
  result: Pick<WeeklyPlanningTurnExecutionResult, 'failure' | 'responseSource'>,
): boolean {
  return Boolean(result.failure) || result.responseSource === 'system';
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
  questionPresentationContent?: WeeklyPlanningQuestionPresentationContent;
}): WeeklyPlanningTurnExecutionResult {
  const state = params.result.state.questions.length > 0
    ? { ...params.result.state, questions: [params.message] }
    : params.result.state;
  const {
    questionPresentationContent: _unrenderedContent,
    recoveryPresentation: _unverifiedRecovery,
    ...result
  } = params.result;
  return {
    ...result,
    state,
    message: params.message,
    responseSource: params.responseSource,
    dialogueRendererTrace: params.dialogueRendererTrace,
    ...(params.questionPresentationContent && state.lastQuestionContext
      ? { questionPresentationContent: params.questionPresentationContent }
      : {}),
  };
}

function questionPresentationContent(params: {
  result: WeeklyPlanningTurnExecutionResult;
  renderInput: WeeklyPlanningStableV5DialogueRenderInput;
  responseSource: 'ai' | 'deterministic_fallback';
  notice: string | null;
}): WeeklyPlanningQuestionPresentationContent {
  // Mirrors what the renderer receives as groundingContext (non-rejected records).
  const unresolved = (params.result.state.groundingRecords ?? [])
    .filter((record) => record.status === 'proposed' || record.status === 'contested');
  return {
    responseSource: params.responseSource,
    currentTurnGrounding: params.renderInput.currentTurnGrounding?.mode ?? 'none',
    selfRepairNotice: params.notice !== null,
    groundingContext: {
      proposed: unresolved.filter((record) => record.status === 'proposed').length,
      contested: unresolved.filter((record) => record.status === 'contested').length,
    },
    previewPromotionControl: params.renderInput.previewPromotionControlLabel != null,
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

function schedulableWorkFallbackText(
  intent: Extract<WeeklyPlanningStableV5DialogueQuestionIntent, { kind: 'schedulable_work_detail' }>,
): string {
  if (intent.mode === 'all_requested_work_complete') {
    return '指定された作業は完了済みです。ほかに予定へ加えたい作業や、考慮したい予定・制約があれば教えてください。';
  }
  if (intent.mode === 'missing_task_identity') {
    return '予定に入れたい作業を一つ教えてください。';
  }
  if (intent.mode === 'registered_material_target_scope') {
    const unit = intent.knownUnitLabel?.trim() || '単位';
    const total = intent.knownTotalUnits;
    const current = intent.knownCurrentUnits;
    const remaining = intent.knownRemainingUnits;
    if (
      typeof total === 'number'
      && Number.isFinite(total)
      && typeof current === 'number'
      && Number.isFinite(current)
      && typeof remaining === 'number'
      && Number.isFinite(remaining)
    ) {
      return `本棚では全${total}${unit}のうち${current}${unit}まで進んでいて、残りは${remaining}${unit}です。今回の計画では残りをすべて進めますか？ それとも今回進める範囲を指定しますか？`;
    }
    return '本棚に保存済みの進捗は確認できています。今回の計画でどこまで進めるかだけ教えてください。';
  }
  if (intent.progressBasis === 'known_bounded_quantity' && intent.knownUnitLabel?.trim()) {
    return `今は${intent.knownUnitLabel.trim()}でどのくらいまで進んでいますか？`;
  }
  return '完成を100%とすると、今はだいたい何%くらいまで進んでいますか？';
}

export function fallbackTextForStableV5TypedIntent(params: {
  applicationText: string;
  questionIntent: WeeklyPlanningStableV5DialogueQuestionIntent | null | undefined;
}): string {
  const intent = params.questionIntent;
  if (intent?.kind === 'learning_strategy_proposal') {
    if (intent.proposalKind === 'mixed_acquisition_review') {
      const { min, max } = intent.reviewSessionDurationMinutes;
      return `今の空き時間では収まりきらないため、新しい範囲は少し長めに学習し、復習は1回${min}〜${max}分で短く分散する方針に切り替えますか？`;
    }
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
  if (intent?.kind === 'schedulable_work_detail') {
    return schedulableWorkFallbackText(intent);
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
        registeredMaterials: createWeeklyPlanningRegisteredMaterialContextV5({
          ownerId: params.input.userId,
          materials: params.input.studyMaterials ?? [],
          userText: params.input.userText,
        }),
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
    planningInformation,
    effortMeasurement: params.result.state.lastQuestionContext?.intent ?? null,
  });
  const previewPromotionControlLabel = params.result.state.status === 'draft_ready'
    ? WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL
    : null;
  const fallbackText = fallbackTextForStableV5TypedIntent({
    applicationText: params.result.message,
    questionIntent,
  });
  const previousQuestionCode = questionCodeFromTargetSlot(
    params.input.previousState?.lastQuestionContext?.targetSlot,
  );
  const currentTurnGrounding = createWeeklyPlanningStableV5CurrentTurnGrounding({
    graph: params.result.stableV5Graph,
    turnId: params.input.traceRequestId,
    actionKind: params.actionKind,
    previousQuestionCode,
    currentQuestionCode: params.questionCode,
  });
  return {
    actionId: params.actionId,
    currentUserMessage: params.input.userText,
    recentConversation: params.input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    planningInformation,
    currentTurnGrounding,
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
  if (isWeeklyPlanningStableV5SystemResult(params.result)) {
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
      questionPresentationContent: questionPresentationContent({
        result: params.result,
        renderInput,
        responseSource: 'deterministic_fallback',
        notice,
      }),
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
    questionPresentationContent: questionPresentationContent({
      result: params.result,
      renderInput,
      responseSource: 'ai',
      notice,
    }),
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

/** Failure-only presentation. The graph/state used here are retained evidence, never a commit. */
export async function renderWeeklyPlanningStableV5RecoveryMessage(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
}): Promise<WeeklyPlanningTurnExecutionResult> {
  const { input } = params;
  const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
  const canDispatchRecovery = () => input.isCurrentTurn?.() === true
    && session?.ownerId === input.userId
    && getWeeklyPlanningStableV5RuntimeSession(input.conversationId)?.ownerId === input.userId
    && getWeeklyPlanningStableV5RuntimeSession(input.conversationId)?.graph.revision === session.graph.revision;
  if (!session || !canDispatchRecovery()) return params.result;
  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: input.previousState, inputStateRevision: input.inputStateRevision,
    messages: input.messages, graphRevision: session.graph.revision,
  });
  const retained = { ...params.result, state: input.previousState ?? params.result.state,
    stableV5Graph: session.graph };
  const retainedCode = freshness.status === 'fresh' ? questionCode(retained) : null;
  const currentActionId = actionId({ traceRequestId: input.traceRequestId,
    actionKind: retainedCode ? 'question' : 'status', questionCode: retainedCode });
  const candidate = createRenderInput({ input, result: retained, notice: null,
    actionKind: retainedCode ? 'question' : 'status', questionCode: retainedCode,
    actionId: currentActionId });
  if (freshness.status === 'fresh' && retainedCode) {
    const originalTarget = freshness.questionContext.topicId;
    if (originalTarget !== undefined && candidate.questionTarget?.fact.id !== originalTarget) return params.result;
    if (retainedCode === 'missing_schedulable_work') {
      const currentQuestion = stableV5MissingSchedulableWorkQuestion(session.graph);
      if ((currentQuestion.targetFactId ?? undefined) !== originalTarget
        || currentQuestion.intent !== freshness.questionContext.intent) return params.result;
    } else if (originalTarget === undefined
      && retainedCode !== 'invalid_planning_horizon' && retainedCode !== 'ambiguous_planning_window') {
      return params.result;
    }
    if (retainedCode === 'quantity_role_unresolved' && candidate.questionTarget?.collection !== 'workloads') return params.result;
    if (retainedCode === 'semantic_uncertainty' && candidate.questionTarget?.collection !== 'uncertainties') return params.result;
    if (retainedCode === 'learning_strategy_proposal') {
      const proposals = (input.previousState?.learningStrategyProposalRecords ?? [])
        .filter((proposal) => proposal.id === freshness.questionContext.actionId && proposal.status === 'pending');
      const proposal = proposals.length === 1 ? proposals[0] : null;
      if (!proposal || candidate.questionTarget?.collection !== 'workloads'
        || candidate.questionIntent?.kind !== 'learning_strategy_proposal'
        || proposal.workloadFactId !== originalTarget
        || candidate.questionIntent.targetFactId !== originalTarget
        || proposal.taskId !== candidate.questionTarget.fact.taskId) return params.result;
    }
  }
  // A stale or irreconstructible question is never recovered from old assistant prose.
  const asksRetainedQuestion = freshness.status === 'fresh' && candidate.questionIntent != null;
  const questionEvidence = asksRetainedQuestion ? recoveryQuestionEvidenceForStableV5Dialogue(candidate) : undefined;
  if (asksRetainedQuestion && !questionEvidence) return params.result;
  const renderInput: WeeklyPlanningStableV5DialogueRenderInput = {
    ...candidate,
    planningInformation: candidate.planningInformation ? { ...candidate.planningInformation,
      groundingRecords: [], selfRepairNotice: null } : null,
    actionKind: asksRetainedQuestion ? 'question' : 'status',
    questionCode: asksRetainedQuestion ? retainedCode : null,
    questionIntent: asksRetainedQuestion ? candidate.questionIntent : null,
    questionTarget: asksRetainedQuestion ? candidate.questionTarget : null,
    currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
    previewPromotionControlLabel: null,
    requiredLabels: candidate.requiredLabels.filter((label) => label !== WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL),
    fallbackText: '', previewCount: 0,
    recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true,
      retainedPreviewUnchanged: (input.retainedPreviewCount ?? 0) > 0 },
    ...(questionEvidence ? { recoveryQuestionEvidence: questionEvidence } : {}),
  };
  recordWeeklyPlanningDialogueRendererRequestV5({ requestId: input.traceRequestId, input: renderInput });
  const rendered = await createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig(), undefined,
    { canDispatchRecovery }).render(renderInput);
  recordWeeklyPlanningDialogueRendererResponseV5({ requestId: input.traceRequestId,
    actionId: currentActionId, rendered, selfRepairNotice: null });
  if (rendered.status !== 'rendered' || rendered.recoveryVerified !== true || !canDispatchRecovery()) {
    // Keep the failed attempt trace (including verifier), but never its candidate question.
    return { ...params.result, dialogueRendererTrace: {
      ...createWeeklyPlanningSystemDialogueRendererTrace(params.result.message),
      actionId: currentActionId, actionKind: renderInput.actionKind, questionCode: renderInput.questionCode,
      request: { purpose: 'weekly_planning_renderer', requiredLabels: renderInput.requiredLabels,
        fallbackText: '', previewCount: 0 },
      response: { status: 'fallback',
        reason: rendered.status === 'fallback' ? rendered.reason : 'recovery_no_longer_current',
        rawResponse: rendered.rawResponse,
        renderedText: rendered.status === 'rendered' ? rendered.text : null },
    } };
  }
  const output = withAssistantMessage({ result: params.result, message: rendered.text, responseSource: 'ai',
    dialogueRendererTrace: createWeeklyPlanningAiRenderedDialogueTrace({
      actionId: currentActionId, actionKind: renderInput.actionKind,
      questionCode: renderInput.questionCode, renderInput, rendered, finalMessage: rendered.text,
    }),
  });
  return {
    ...output,
    recoveryPresentation: { question: asksRetainedQuestion && freshness.status === 'fresh'
      ? { graphRevision: session.graph.revision, previousAssistantMessageId: freshness.presentation.assistantMessageId }
      : null },
    ...(asksRetainedQuestion && freshness.status === 'fresh' ? {
      questionPresentationContent: { responseSource: 'ai' as const, currentTurnGrounding: 'none' as const,
        selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false },
    } : {}),
  };
}
