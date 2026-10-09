import { getAiConfig } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  getWeeklyPlanningTurnDispatchBudget,
  withWeeklyPlanningTurnDispatchBudget,
} from '../application/weeklyPlanningTurnDispatchBudget';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  type WeeklyPlanningStableV5DialogueActionKind,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';
import type {
  WeeklyPlanningStableV5DialogueQuestionIntent,
} from './weeklyPlanningStableV5DialogueContracts';
import { communicationContextForStableV5Dialogue } from './weeklyPlanningStableV5CommunicationContext';
import { retainedPreviewCommunicationForStableV5Dialogue } from './weeklyPlanningRetainedPreviewCommunication';
import { composeWeeklyPlanningInteractionFallbackText, WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT, WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT } from './weeklyPlanningInteractionFallbackText';
import { weeklyPlanningUncertaintyReleaseText } from './weeklyPlanningUncertaintyReleaseDisclosure';
import { weeklyPlanningCapacityShortfallText } from './weeklyPlanningCapacityShortfallDisclosure';
import { weeklyPlanningPreviewConstraintDisclosureText, weeklyPlanningPreviewOmissionDisclosureText } from './weeklyPlanningPreviewOmissionDisclosure';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';
import { scheduleCommunicationIntent } from '../application/weeklyPlanningFixedEventOnlyInteraction';
import { stableV5ScheduleQuestionText } from '../application/weeklyPlanningStableV5RuntimeQuestions';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { placementCandidateBlocks } from '../semantic/weeklyPlanningStableV5PlacementCandidates';
import { withStableV5GroundingProposal } from '../application/weeklyPlanningStableV5GroundingFlow';
import {
  decodeWeeklyPlanningStableV5QuestionSlot,
} from '../intake/weeklyPlanningStableV5QuestionSlot';
import {
  learningStrategyProposalIntentForStableV5Dialogue,
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  requiredLabelsForStableV5Dialogue,
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
  weeklyPlanningTurnRemovalsV5,
  type WeeklyPlanningSelfRepairNoticeV5,
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

function questionCode(result: WeeklyPlanningTurnExecutionResult): string | null {
  return decodeWeeklyPlanningStableV5QuestionSlot(
    result.state.lastQuestionContext?.targetSlot,
  );
}

function questionCodeFromTargetSlot(targetSlot: string | undefined): string | null {
  return decodeWeeklyPlanningStableV5QuestionSlot(targetSlot);
}

/**
 * Interaction outcomes that keep the retained machine question but do not present it in
 * this reply: an aside, and a recovery turn whose question was not fresh. The question is
 * neither offered to the renderer nor re-bound, so it cannot be mistaken as asked.
 */
function holdsQuestionBack(result: WeeklyPlanningTurnExecutionResult): boolean {
  const outcome = result.interactionOutcome;
  return outcome?.kind === 'aside'
    || (outcome?.kind === 'recover' && !outcome.representedQuestion);
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
}): WeeklyPlanningSelfRepairNoticeV5 | null {
  if (!params.result.stableV5Graph) return null;
  return createWeeklyPlanningSelfRepairNoticeV5({
    graph: params.result.stableV5Graph,
    currentTurnId: params.input.traceRequestId,
  });
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
  /** An aside keeps the retained machine question text; the message is not that question. */
  keepQuestions?: boolean;
}): WeeklyPlanningTurnExecutionResult {
  const state = params.result.state.questions.length > 0 && !params.keepQuestions
    ? { ...params.result.state, questions: [params.message] }
    : params.result.state;
  const {
    questionPresentationContent: _unrenderedContent,
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
  architecture?: WeeklyPlanningConversationArchitecture,
): string {
  const interaction = conversationArchitecturePolicy(architecture).interactionOutcome;
  if (intent.mode === 'all_requested_work_complete') {
    return interaction
      ? '指定された勉強は終わっています。ほかに勉強したいことや、考慮してほしい予定があれば教えてください。'
      : '指定された作業は完了済みです。ほかに予定へ加えたい作業や、考慮したい予定・制約があれば教えてください。';
  }
  if (intent.mode === 'missing_task_identity') {
    return interaction
      ? stableV5ScheduleQuestionText('identify_study_work')
      : '予定に入れたい作業を一つ教えてください。';
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
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
}): string {
  const intent = params.questionIntent;
  if (intent?.kind === 'schedule_request'
    && conversationArchitecturePolicy(params.conversationArchitecture).interactionOutcome) {
    return stableV5ScheduleQuestionText(intent.purpose);
  }
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
    return schedulableWorkFallbackText(intent, params.conversationArchitecture);
  }
  return params.applicationText;
}

function createRenderInput(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
  notice: string | null;
  selfRepair: WeeklyPlanningSelfRepairNoticeV5 | null;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  actionId: string;
}): WeeklyPlanningStableV5DialogueRenderInput {
  const interaction = conversationArchitecturePolicy(params.input.conversationArchitecture)
    .interactionOutcome;
  const planningInformation = params.result.stableV5Graph
    ? {
        ...createWeeklyPlanningStableV5DialogueProjection(params.result.stableV5Graph),
        registeredMaterials: createWeeklyPlanningRegisteredMaterialContextV5({
          ownerId: params.input.userId,
          materials: params.input.studyMaterials ?? [],
          userText: params.input.userText,
        }),
        groundingRecords: groundingRecords(params.result),
        // Interaction: the correction (and anything removed in this turn) as typed data, for the
        // renderer to acknowledge in its own words. Legacy: the pre-#488 prewritten sentence.
        ...(interaction
          ? {
              selfRepair: params.selfRepair
                ? {
                    taskLabel: params.selfRepair.taskLabel,
                    before: params.selfRepair.before,
                    after: params.selfRepair.after,
                  }
                : null,
              removedThisTurn: weeklyPlanningTurnRemovalsV5({
                graph: params.result.stableV5Graph,
                currentTurnId: params.input.traceRequestId,
              }),
            }
          : { selfRepairNotice: params.notice }),
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
  const scheduleIntent = interaction && params.questionCode === 'missing_schedulable_work'
    ? params.result.communicationFacts?.scheduleIntent
      ?? (params.result.stableV5Graph
        ? scheduleCommunicationIntent(createWeeklyPlanningActiveSchedulerGraphViewV5(params.result.stableV5Graph))
        : 'clarify_schedule_request')
    : undefined;
  const questionIntent = scheduleIntent && scheduleIntent !== 'identify_study_work' && !targetFactId
    ? { kind: 'schedule_request' as const, purpose: scheduleIntent,
        requestedInformation: ['schedule_request'] as const }
    : proposalIntent ?? questionIntentForStableV5Dialogue({
    questionCode: params.questionCode,
    questionTarget,
    planningInformation,
    effortMeasurement: params.result.state.lastQuestionContext?.intent ?? null,
  });
  // Interaction: a message the application could not use changed nothing, so the previous
  // preview is not presented as its result (live C on d7b85616 invited promoting the old
  // 30-page preview after the 20-page correction was rejected). The preview card stays.
  const unusedTurn = interaction && params.result.interactionOutcome?.kind === 'recover';
  const retainedPreviewCommunication = interaction
    ? retainedPreviewCommunicationForStableV5Dialogue({
        preview: params.result.draftCandidates.length > 0
          ? { candidateCount: params.result.draftCandidates.length,
              placements: placementCandidateBlocks(params.result.draftCandidates).map(({ taskId, date }) => ({ taskId, date })) }
          : params.result.preserveExistingPreview || unusedTurn ? params.input.currentPreview : undefined,
        outcome: params.result.interactionOutcome,
        consultation: params.result.interactionOutcome?.consultationDeferred
          ? params.result.communicationFacts?.consultation : null,
      })
    : {};
  const previewPromotionControlLabel = params.result.state.status === 'draft_ready' && !unusedTurn
    && !retainedPreviewCommunication.alternativeRequiresAdoption
    ? WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL
    : null;
  const typedFallbackText = fallbackTextForStableV5TypedIntent({
    applicationText: params.result.message,
    questionIntent,
    conversationArchitecture: params.input.conversationArchitecture,
  });
  // Interaction architecture: the application states WHAT to communicate as a typed context;
  // the renderer writes the words. The emergency text is composed from the same context.
  const communication = interaction
    ? { ...communicationContextForStableV5Dialogue({
        outcome: params.result.interactionOutcome,
        // A generic schedule invitation must not mask a required progress/scope target.
        facts: params.result.communicationFacts && targetFactId && params.questionCode === 'missing_schedulable_work'
          && params.result.communicationFacts.scheduleIntent !== 'identify_study_work'
          ? { ...params.result.communicationFacts, scheduleIntent: undefined }
          : params.result.communicationFacts,
        actionKind: params.actionKind,
        questionCode: params.questionCode,
        questionIntent,
      }), ...retainedPreviewCommunication }
    : null;
  const fallbackText = communication
    ? composeWeeklyPlanningInteractionFallbackText({
        communication,
        questionText: params.actionKind === 'question' ? typedFallbackText : '',
        questionCode: params.questionCode,
        previewCount: params.result.draftCandidates.length,
        previewPromotionControlLabel,
        groundingNote: withStableV5GroundingProposal({
          message: '',
          records: params.result.state.groundingRecords ?? [],
          currentTurnId: params.input.traceRequestId,
        }),
      })
    : typedFallbackText;
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
      // A question that asks for study work names no accepted target (a fixed commitment is context only).
      targetFactId: questionIntent?.kind === 'schedulable_work_detail' && questionIntent.mode === 'missing_task_identity'
        ? null : targetFactId,
      includePreviewPromotionControl: previewPromotionControlLabel !== null,
    }),
    conversationArchitecture: params.input.conversationArchitecture,
    ...(communication ? { communication } : {}),
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

  const selfRepair = selfRepairNotice(params);
  const notice = selfRepair?.message ?? null;
  // Presented as a status: the retained question stays in machine state but is not offered
  // to (or re-bound for) the renderer, so it cannot be mistaken as asked.
  const aside = holdsQuestionBack(params.result);
  const renderResult: WeeklyPlanningTurnExecutionResult = aside
    ? {
        ...params.result,
        state: { ...params.result.state, lastQuestionContext: undefined },
      }
    : params.result;
  const actionKind = dialogueActionKind(renderResult);
  const currentQuestionCode = questionCode(renderResult);
  const currentActionId = actionId({
    traceRequestId: params.input.traceRequestId,
    actionKind,
    questionCode: currentQuestionCode,
  });
  const renderInput = createRenderInput({
    ...params,
    result: renderResult,
    notice,
    selfRepair,
    actionKind,
    questionCode: currentQuestionCode,
    actionId: currentActionId,
  });
  recordWeeklyPlanningDialogueRendererRequestV5({
    requestId: params.input.traceRequestId,
    input: renderInput,
  });

  const aiConfig = getAiConfig();
  const rendered = await createAiWeeklyPlanningStableV5DialogueRenderer(
    aiConfig,
    withWeeklyPlanningTurnDispatchBudget(
      createOpenAiCompatibleClient(aiConfig),
      getWeeklyPlanningTurnDispatchBudget(params.input.traceRequestId),
      'renderer',
    ),
  ).render(renderInput);
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
      keepQuestions: aside,
      ...(aside ? {} : {
        questionPresentationContent: questionPresentationContent({
          result: params.result,
          renderInput,
          responseSource: 'deterministic_fallback',
          notice,
        }),
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

  // Work the scheduler left out is stated by the application next to the rendered reply.
  const disclosure = renderInput.communication?.previewDisclosure;
  const previewMessage = disclosure
    ? `${rendered.text}\n\n${weeklyPlanningPreviewOmissionDisclosureText(disclosure.omittedWork)}`
    : rendered.text;
  const constraintDisclosure = weeklyPlanningPreviewConstraintDisclosureText(renderInput.communication?.previewConstraintSatisfaction);
  const shortfall = renderInput.communication?.capacityShortfall;
  const shortfallMessage = shortfall ? `${previewMessage}\n\n${weeklyPlanningCapacityShortfallText(shortfall)}` : previewMessage;
  const disclosedMessage = constraintDisclosure ? `${shortfallMessage}\n\n${constraintDisclosure}` : shortfallMessage;
  // Semantic recovery that kept the preview: the application states it; the renderer may not.
  const retainedPreviewNotice = renderInput.communication?.goal === 'clarify_turn'
    && renderInput.communication.retainedPreviewUnchanged
    ? WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT : null;
  const omissionNotice = renderInput.communication?.possibleCompletenessOmission
    ? WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT : null;
  const releaseNotice = renderInput.communication?.uncertaintyReleased
    ? weeklyPlanningUncertaintyReleaseText(renderInput.communication.uncertaintyReleased.quote) : null;
  const finalMessage = [disclosedMessage, retainedPreviewNotice, omissionNotice, releaseNotice].filter(Boolean).join('\n\n');
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
    keepQuestions: aside,
    ...(aside ? {} : {
      questionPresentationContent: questionPresentationContent({
        result: params.result,
        renderInput,
        responseSource: 'ai',
        notice,
      }),
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
