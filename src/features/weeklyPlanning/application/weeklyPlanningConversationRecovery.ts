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
  fallbackTextForStableV5TypedIntent,
} from '../dialogue/weeklyPlanningStableV5TurnDialogue';
import {
  learningStrategyProposalIntentForStableV5Dialogue,
} from '../dialogue/weeklyPlanningStableV5DialogueContext';
import {
  stableV5MissingSchedulableWorkQuestion,
  typedStableV5RuntimeQuestionText,
} from './weeklyPlanningStableV5RuntimeQuestions';
import { emptyWeeklyPlanningTurnCommunicationFacts } from './weeklyPlanningInteractionOutcome';
import {
  weeklyPlanningInteractionProviderUnavailableText,
} from '../dialogue/weeklyPlanningInteractionFallbackText';

/**
 * Conversational recovery for a turn whose semantic step failed (interaction architecture).
 * Nothing authoritative changes: the accepted graph, preview and machine state stay as they
 * were. This module decides only WHAT the reply has to do, as a typed `recover` outcome:
 * which failure it was and - only when a fresh machine question exists - that the same
 * question is asked again, so the next reply keeps its target. It writes no explanation.
 *
 * - Semantic failure (the model answered but nothing usable came out): the message is just
 *   the application-typed question (or empty). The dialogue renderer writes the reply from
 *   the typed outcome (`clarify_turn`); only if it fails is the emergency wording used.
 * - Provider failure (network/HTTP/timeout): the renderer is not called, because the same AI
 *   provider just failed. The short emergency wording asks for a resend and never invents a
 *   content question.
 *
 * Neither path exposes validator or provider payloads or describes the app's internals.
 */
export type WeeklyPlanningRecoveryFailure = 'provider' | 'semantic';

const RECOVERY_PRESENTATION_CONTENT: WeeklyPlanningQuestionPresentationContent = {
  responseSource: 'deterministic_fallback',
  currentTurnGrounding: 'none',
  selfRepairNotice: false,
  groundingContext: { proposed: 0, contested: 0 },
  previewPromotionControl: false,
};

/**
 * The deterministic application text for the retained question, or null (fail closed:
 * nothing is re-presented and no presentation is bound). Never the previously shown
 * assistant message - that may be AI-rendered and carry that turn's acknowledgement.
 */
function retainedQuestionText(params: {
  previousState: PlanningIntakeState;
  context: WeeklyPlanningQuestionContext;
  graph: WeeklyPlanningFactGraphV5;
}): string | null {
  const { context, graph, previousState } = params;
  const code = decodeWeeklyPlanningStableV5QuestionSlot(context.targetSlot);
  if (!code) return null;

  if (code === 'learning_strategy_proposal') {
    const intent = learningStrategyProposalIntentForStableV5Dialogue({
      questionCode: code,
      actionId: context.actionId ?? null,
      proposalRecords: previousState.learningStrategyProposalRecords ?? [],
    });
    return intent
      ? fallbackTextForStableV5TypedIntent({ applicationText: '', questionIntent: intent }) || null
      : null;
  }
  if (code === 'missing_schedulable_work') {
    const missing = stableV5MissingSchedulableWorkQuestion(graph);
    // Only the question that is still the same target; otherwise the machine has moved on.
    return (missing.targetFactId ?? undefined) === context.topicId ? missing.message : null;
  }

  const effort = context.intent;
  return typedStableV5RuntimeQuestionText(graph, {
    domain: 'work_item',
    code: code as Parameters<typeof typedStableV5RuntimeQuestionText>[1]['code'],
    factId: context.topicId ?? null,
    details: {},
    effortMeasurement: effort === 'total_duration'
      || effort === 'duration_per_unit'
      || effort === 'session_duration'
      ? effort
      : null,
  });
}

export function createWeeklyPlanningConversationRecoveryOutput(params: {
  failure: WeeklyPlanningRecoveryFailure;
  previousState: PlanningIntakeState | undefined;
  userText: string;
  graph: WeeklyPlanningFactGraphV5;
  pendingQuestionPresentation: WeeklyPlanningQuestionPresentationFreshness;
  /** D2: the user's planning details were read but not applied (a rejected reading), whatever route rejected it. */
  planningDetailsNotApplied?: boolean;
}): WeeklyPlanningTurnExecutionResult {
  const { previousState, pendingQuestionPresentation } = params;
  const questionText = previousState && pendingQuestionPresentation.status === 'fresh'
    ? retainedQuestionText({
        previousState,
        context: pendingQuestionPresentation.questionContext,
        graph: params.graph,
      })
    : null;

  const message = params.failure === 'provider'
    ? weeklyPlanningInteractionProviderUnavailableText(questionText)
    : questionText ?? '';

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
    communicationFacts: params.planningDetailsNotApplied && params.failure === 'semantic'
      ? { ...emptyWeeklyPlanningTurnCommunicationFacts(), planningDetailsNotApplied: true }
      : emptyWeeklyPlanningTurnCommunicationFacts(),
    ...(questionText && pendingQuestionPresentation.status === 'fresh'
      ? {
          questionPresentationContent: { ...RECOVERY_PRESENTATION_CONTENT },
          questionPresentationGraphRevision: pendingQuestionPresentation.presentation.graphRevision,
        }
      : {}),
  };
}
