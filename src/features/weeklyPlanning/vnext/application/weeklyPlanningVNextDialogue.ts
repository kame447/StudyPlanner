// The natural reply of a VNext turn comes from the existing Stable V5 renderer.
// The confirmed result of the turn (the stated facts, the question asked, the
// preview shown) becomes the renderer's typed input through V5's own context
// helpers; the renderer explains and never changes state. Only what V5 cannot
// know is supplied here: an estimate question names the asked work's amount
// (which may be derived, e.g. total − completed), and a VNext-only question asks
// for clarification with its option labels required in the text.
// The renderer has no state authority: its text is stored only as what was shown
// (the presented question's shownText, for binding the next answer), never read
// as a fact. Breaks if the reply text is parsed back into facts or a failed render
// still presents its question. Tests: ExperimentalSession integration "explains each
// result through the Stable V5 renderer…", OptionChoice "offers Jev the displayed text…".
import type { VNextQuestion, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import {
  createWeeklyPlanningStableV5CurrentTurnGrounding,
  createWeeklyPlanningStableV5DialogueProjection,
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  RENDERER_TECHNICAL_STOP,
  requiredLabelsForStableV5Dialogue,
  learningStrategyProposalIntentForStableV5Dialogue,
  WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL,
  type WeeklyPlanningStableV5DialogueQuestionIntent,
  type WeeklyPlanningFixedEventCommunicationFacts,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from '../weeklyPlanningVNextV5Boundary';
import { createVNextLineageResolver, withCurrentVNextReferences } from '../weeklyPlanningVNextWorkIdentity';
import { presentWeeklyPlanningVNextQuestion } from './weeklyPlanningVNextQuestionText';
import type { WeeklyPlanningVNextShownPreview } from './weeklyPlanningVNextSessionCheckpoint';

/** As many recent messages as the Stable V5 renderer reads. */
export const VNEXT_RECENT_MESSAGE_LIMIT = 4;

export interface WeeklyPlanningVNextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const VNEXT_REPEATED_REMAINING_INCONSISTENT_GUIDANCE =
  '全体から完了量を引いた残りと、入力された残量が一致しません。どの値を直すか選んでください。';
export const VNEXT_REPEATED_SAME_OR_DISTINCT_WORK_GUIDANCE =
  '複数の量や時間が、別々に行う作業なのか、同じ作業を表しているのかが未確定です。予定に含める作業を、表示した選択肢から選んでください。';

export const VNEXT_REPEATED_EFFORT_INCONSISTENT_GUIDANCE =
  '時間の見積もりが一致していません。どの見積もりを何分に訂正するか、対象と時間を指定してください。今決められなければ「今回は保留」と答えられます。';
export const VNEXT_REPEATED_COMPLETED_EXCEEDS_TOTAL_GUIDANCE =
  '終わった量が全体の量を超えています。全体の量と終わった量のどちらを訂正するか、対象と量を指定してください。今決められなければ「今回は保留」と答えられます。';

/** Typed extension on V5's existing presentation-only communication channel. */
type VNextDialogueRenderInput = WeeklyPlanningStableV5DialogueRenderInput & {
  communication: NonNullable<WeeklyPlanningStableV5DialogueRenderInput['communication']> & {
    previewAuthorization?: { status: 'authorization_required'; requestedPlanningIntent: 'create_plan' };
  };
};

function questionIntent(state: WeeklyPlanningVNextState, question: VNextQuestion,
  planningInformation: Record<string, unknown>, targetFactId: string): WeeklyPlanningStableV5DialogueQuestionIntent | null {
  if (question.proposal) return learningStrategyProposalIntentForStableV5Dialogue({ questionCode: question.code,
    actionId: question.proposal.id, proposalRecords: state.learningStrategyProposalRecords });
  if (question.code === 'missing_effort_estimate' && question.forWork) {
    // Asked work is a target, or what remains (stated, or the total less what is done).
    const defining = state.graph.workloads.find((workload) => workload.id === question.forWork!.definingFactId);
    return { kind: 'effort_measurement', measurement: question.effortMeasurement ?? 'total_duration',
      quantityRole: defining?.quantityRole === 'target' ? 'target' : 'remaining',
      targetFactId, amount: question.forWork.amount, unitCode: null, unitLabel: question.forWork.unitLabel };
  }
  const questionTarget = questionTargetForStableV5Dialogue({ planningInformation, targetFactId });
  return questionIntentForStableV5Dialogue({ questionCode: question.code, questionTarget, planningInformation })
    ?? { kind: 'resolution_question', resolutionKind: 'semantic_clarification', targetFactId,
      requestedInformation: ['clarify_ambiguous_meaning'], allowedChoices: [], knownAmount: null, knownUnitLabel: null,
      ambiguityField: question.code, ambiguityReason: null };
}

export function createWeeklyPlanningVNextRenderInput(params: {
  state: WeeklyPlanningVNextState;
  question: VNextQuestion | null;
  preview: WeeklyPlanningVNextShownPreview | null;
  actionId: string;
  /** The turn whose accepted facts ground the reply. */
  turnId: string;
  previousQuestionCode: string | null;
  userText: string;
  recentConversation: readonly WeeklyPlanningVNextMessage[];
  authorizationRequired?: boolean;
  repeatedQuestionGuidance?: boolean;
  registrationCommunication?: WeeklyPlanningFixedEventCommunicationFacts;
}): VNextDialogueRenderInput {
  const { state, question, preview } = params;
  // The renderer's helpers follow exact ids, so they read the facts with current references.
  const { leafOf } = createVNextLineageResolver(state.graph);
  const graph = withCurrentVNextReferences(state.graph, (id) => leafOf(id) ?? id);
  const planningInformation = createWeeklyPlanningStableV5DialogueProjection(graph);
  const actionKind = question ? 'question' : preview ? 'preview_ready' : 'status';
  const asked = question ? question.forWork?.definingFactId ?? question.taskId : null;
  const targetFactId = asked === null ? null : leafOf(asked) ?? asked;
  const optionLabels = question ? Object.values(presentWeeklyPlanningVNextQuestion(state, question).optionLabels) : [];
  // A conflict has no option binding: show the retained estimates and request an explicit correction or deferral.
  const effortConflictLabels = params.repeatedQuestionGuidance && question?.code === 'effort_inconsistent'
    ? graph.effortEstimates.filter(estimate => question.subjectLineageIds.some(id => (leafOf(id) ?? id) === estimate.id))
      .map(estimate => `${estimate.kind === 'duration_per_unit' ? `1${estimate.unitLabel ?? '単位'}あたり`
        : estimate.kind === 'session_duration' ? '1回' : '全体'}${estimate.minutes}分${estimate.precision === 'approximate' ? 'くらい' : ''}`)
    : [];
  const completedConflictLabels = params.repeatedQuestionGuidance && question?.code === 'completed_exceeds_total'
    ? graph.workloads.filter(workload => question.subjectLineageIds.some(id => (leafOf(id) ?? id) === workload.id))
      .map(workload => `${workload.quantityRole === 'completed' ? '完了' : '全体'}${workload.amount}${workload.unitLabel}`)
    : [];
  return {
    communication: {
      goal: actionKind === 'question' ? params.repeatedQuestionGuidance ? 'explain_question' : 'ask_question'
        : actionKind === 'preview_ready' ? 'present_preview' : 'acknowledge',
      askQuestion: actionKind === 'question',
      ...params.registrationCommunication,
      ...(params.authorizationRequired ? { previewAuthorization: {
        status: 'authorization_required' as const, requestedPlanningIntent: 'create_plan' as const,
      } } : {}),
    },
    actionId: params.actionId,
    currentUserMessage: params.userText,
    recentConversation: params.recentConversation.slice(-VNEXT_RECENT_MESSAGE_LIMIT).map(({ role, content }) => ({ role, content })),
    planningInformation,
    currentTurnGrounding: createWeeklyPlanningStableV5CurrentTurnGrounding({ graph, turnId: params.turnId,
      actionKind, previousQuestionCode: params.previousQuestionCode, currentQuestionCode: question?.code ?? null }),
    actionKind,
    questionCode: question?.code ?? null,
    questionTarget: targetFactId ? questionTargetForStableV5Dialogue({ planningInformation, targetFactId }) : null,
    questionIntent: question?.optionalInvitation
      ? questionIntentForStableV5Dialogue({ questionCode: question.code, questionTarget: null, planningInformation,
        effortMeasurement: question.optionalInvitation.intent })
      : question && targetFactId ? questionIntent(state, question, planningInformation, targetFactId) : null,
    previewPromotionControlLabel: preview ? WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL : null,
    requiredLabels: [...new Set([...requiredLabelsForStableV5Dialogue({ planningInformation, targetFactId,
      includePreviewPromotionControl: preview !== null }), ...optionLabels, ...effortConflictLabels, ...completedConflictLabels,
      ...(params.repeatedQuestionGuidance && (question?.code === 'missing_effort_estimate'
        || question?.code === 'missing_schedulable_work')
        ? ['何分くらい', '所要時間はまだ分からないので、仮置きで予定を組んで見せて', '後で決める'] : []),
      ...(params.repeatedQuestionGuidance && question?.code === 'remaining_inconsistent'
        ? [VNEXT_REPEATED_REMAINING_INCONSISTENT_GUIDANCE] : []),
      ...(params.repeatedQuestionGuidance && question?.code === 'same_or_distinct_work'
        ? [VNEXT_REPEATED_SAME_OR_DISTINCT_WORK_GUIDANCE] : []),
      ...(params.repeatedQuestionGuidance && question?.code === 'effort_inconsistent'
        ? [VNEXT_REPEATED_EFFORT_INCONSISTENT_GUIDANCE] : []),
      ...(params.repeatedQuestionGuidance && question?.code === 'completed_exceeds_total'
        ? [VNEXT_REPEATED_COMPLETED_EXCEEDS_TOTAL_GUIDANCE] : [])])],
    fallbackText: params.authorizationRequired
      ? '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。'
      : RENDERER_TECHNICAL_STOP,
    previewCount: preview?.blocks.length ?? 0,
  };
}
