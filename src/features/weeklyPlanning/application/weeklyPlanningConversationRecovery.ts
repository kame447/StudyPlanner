import type {
  PlanningIntakeState,
  WeeklyPlanningQuestionContext,
  WeeklyPlanningQuestionPresentationContent,
} from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import { decodeWeeklyPlanningStableV5QuestionSlot } from '../intake/weeklyPlanningStableV5QuestionSlot';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { projectStableV5CompatibilityOutput } from './weeklyPlanningStableV5CompatibilityState';
import {
  renderStableV5RuntimeQuestion,
  STABLE_V5_TYPED_QUESTION_CODES,
} from './weeklyPlanningStableV5RuntimeQuestions';

/**
 * Conversational recovery for a turn whose semantic step failed. Nothing authoritative
 * changes: the accepted graph, preview and machine state stay as they were. The user
 * sees a system message that says nothing was applied, and - only when a fresh machine
 * question exists - the same question again, so the next reply keeps its target.
 *
 * Provider failures (network/HTTP/timeout) and semantic failures (the model answered but
 * the result could not be validated) are different situations: a provider failure asks
 * for a resend and never invents a content question; neither exposes raw validator or
 * provider payloads.
 */
export type WeeklyPlanningRecoveryFailure = 'provider' | 'semantic';

const PROVIDER_LEAD =
  'AIに接続できなかったため、入力内容は変更していません。接続を確認してもう一度送ってください。';
const SEMANTIC_LEAD =
  'こちらの処理で内容を安全に整理できなかったため、予定条件には反映していません。';
const SEMANTIC_CONTINUE = '続けて、予定に入れたい内容や条件を教えてください。';
const RECOVERY_QUESTION_INTRO = '確認中の質問は変わりません。';

const RECOVERY_PRESENTATION_CONTENT: WeeklyPlanningQuestionPresentationContent = {
  responseSource: 'deterministic_fallback',
  currentTurnGrounding: 'none',
  selfRepairNotice: false,
  groundingContext: { proposed: 0, contested: 0 },
  previewPromotionControl: false,
};

function typedQuestionText(params: {
  context: WeeklyPlanningQuestionContext;
  graph: WeeklyPlanningFactGraphV5;
}): string | null {
  const code = decodeWeeklyPlanningStableV5QuestionSlot(params.context.targetSlot);
  if (!code || !STABLE_V5_TYPED_QUESTION_CODES.has(code)) return null;
  const effort = params.context.intent;
  return renderStableV5RuntimeQuestion(params.graph, {
    domain: 'work_item',
    code: code as Parameters<typeof renderStableV5RuntimeQuestion>[1]['code'],
    factId: params.context.topicId ?? null,
    details: {},
    effortMeasurement: effort === 'total_duration'
      || effort === 'duration_per_unit'
      || effort === 'session_duration'
      ? effort
      : null,
  });
}

/**
 * The text of the retained question. Application-typed text when the question code has
 * one; otherwise the text that was shown with the question (state keeps it verbatim).
 */
function retainedQuestionText(params: {
  previousState: PlanningIntakeState;
  context: WeeklyPlanningQuestionContext;
  graph: WeeklyPlanningFactGraphV5;
}): string | null {
  const typed = typedQuestionText(params);
  if (typed) return typed;
  const shown = params.previousState.questions[0]?.trim();
  return shown ? shown : null;
}

export function createWeeklyPlanningConversationRecoveryOutput(params: {
  failure: WeeklyPlanningRecoveryFailure;
  previousState: PlanningIntakeState | undefined;
  userText: string;
  graph: WeeklyPlanningFactGraphV5;
  pendingQuestionPresentation: WeeklyPlanningQuestionPresentationFreshness;
}): WeeklyPlanningTurnExecutionResult {
  const { previousState, pendingQuestionPresentation } = params;
  const questionText = previousState && pendingQuestionPresentation.status === 'fresh'
    ? retainedQuestionText({
        previousState,
        context: pendingQuestionPresentation.questionContext,
        graph: params.graph,
      })
    : null;

  const lead = params.failure === 'provider' ? PROVIDER_LEAD : SEMANTIC_LEAD;
  const message = questionText
    ? `${lead}${RECOVERY_QUESTION_INTRO}\n\n${questionText}`
    : params.failure === 'provider'
      ? lead
      : `${lead}${SEMANTIC_CONTINUE}`;

  // The accepted machine state is retained exactly. Without a previous state there is
  // nothing to retain and the empty compatibility state is reported.
  const state = previousState ?? projectStableV5CompatibilityOutput({
    previousState: undefined,
    userText: params.userText,
    message,
    draftCandidates: [],
    authorized: false,
  }).state;

  return {
    state,
    message,
    draftCandidates: [],
    interactionOutcome: {
      kind: 'recover',
      failure: params.failure,
      representedQuestion: questionText !== null,
    },
    ...(questionText && pendingQuestionPresentation.status === 'fresh'
      ? {
          questionPresentationContent: { ...RECOVERY_PRESENTATION_CONTENT },
          questionPresentationGraphRevision: pendingQuestionPresentation.presentation.graphRevision,
        }
      : {}),
  };
}
