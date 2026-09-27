import type {
  PlanningIntakeState,
  WeeklyPlanningQuestionContext,
  WeeklyPlanningQuestionPresentation,
  WeeklyPlanningQuestionPresentationContent,
} from './weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../types';

export const WEEKLY_PLANNING_QUESTION_PRESENTATION_VERSION = 1 as const;

export type WeeklyPlanningQuestionPresentationFreshness =
  | {
      status: 'fresh';
      questionContext: WeeklyPlanningQuestionContext;
      presentation: WeeklyPlanningQuestionPresentation;
    }
  | { status: 'no_question' }
  | { status: 'unbound' }
  | { status: 'malformed' }
  | {
      status: 'stale';
      reason:
        | 'input_revision_unknown'
        | 'state_revision_mismatch'
        | 'latest_message_mismatch'
        | 'graph_revision_mismatch';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return isNonNegativeInteger(value);
}

function isPresentationContent(
  value: unknown,
): value is WeeklyPlanningQuestionPresentationContent {
  return isRecord(value)
    && hasExactKeys(value, [
      'responseSource',
      'currentTurnGrounding',
      'selfRepairNotice',
      'groundingContext',
      'previewPromotionControl',
    ])
    && (value.responseSource === 'ai' || value.responseSource === 'deterministic_fallback')
    && (value.currentTurnGrounding === 'none'
      || value.currentTurnGrounding === 'recommended'
      || value.currentTurnGrounding === 'required_before_resume')
    && typeof value.selfRepairNotice === 'boolean'
    && isRecord(value.groundingContext)
    && hasExactKeys(value.groundingContext, ['proposed', 'contested'])
    && isCount(value.groundingContext.proposed)
    && isCount(value.groundingContext.contested)
    && typeof value.previewPromotionControl === 'boolean';
}

/**
 * True only when nothing machine-known other than the question itself may have been
 * rendered in the presenting message. It says nothing about the AI text's semantics.
 */
export function isWeeklyPlanningQuestionPresentationUnaccompanied(
  content: WeeklyPlanningQuestionPresentationContent,
): boolean {
  return content.currentTurnGrounding === 'none'
    && !content.selfRepairNotice
    && content.groundingContext.proposed === 0
    && content.groundingContext.contested === 0
    && !content.previewPromotionControl;
}

/** Strict decoder: persisted state is untrusted, and anything unexpected fails closed. */
export function decodeWeeklyPlanningQuestionPresentation(
  value: unknown,
): WeeklyPlanningQuestionPresentation | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'version',
      'turnId',
      'assistantMessageId',
      'planningStateRevision',
      'graphRevision',
      'content',
    ])
    || value.version !== WEEKLY_PLANNING_QUESTION_PRESENTATION_VERSION
    || !isNonEmptyString(value.turnId)
    || !isNonEmptyString(value.assistantMessageId)
    || !isNonNegativeInteger(value.planningStateRevision)
    || !isNonNegativeInteger(value.graphRevision)
    || !isPresentationContent(value.content)) {
    return null;
  }
  return {
    version: WEEKLY_PLANNING_QUESTION_PRESENTATION_VERSION,
    turnId: value.turnId,
    assistantMessageId: value.assistantMessageId,
    planningStateRevision: value.planningStateRevision,
    graphRevision: value.graphRevision,
    content: {
      ...value.content,
      groundingContext: { ...value.content.groundingContext },
    },
  };
}

/**
 * Binds the question that the turn leaves pending to the assistant message that
 * presents it. Called by the turn controller immediately before the commit that
 * atomically stores the state and that message. Without a pending question or
 * presentation content there is nothing to bind, and the state is returned unchanged.
 */
export function bindWeeklyPlanningQuestionPresentation(params: {
  state: PlanningIntakeState;
  content: WeeklyPlanningQuestionPresentationContent | undefined;
  turnId: string;
  assistantMessageId: string;
  planningStateRevision: number;
  graphRevision: number | undefined;
}): PlanningIntakeState {
  const questionContext = params.state.lastQuestionContext;
  if (!questionContext) return params.state;
  const { presentation: _previous, ...unboundContext } = questionContext;
  const presentation = params.content && params.graphRevision !== undefined
    ? decodeWeeklyPlanningQuestionPresentation({
        version: WEEKLY_PLANNING_QUESTION_PRESENTATION_VERSION,
        turnId: params.turnId,
        assistantMessageId: params.assistantMessageId,
        planningStateRevision: params.planningStateRevision,
        graphRevision: params.graphRevision,
        content: params.content,
      })
    : null;
  return {
    ...params.state,
    lastQuestionContext: presentation
      ? { ...unboundContext, presentation }
      : unboundContext,
  };
}

/**
 * Decides whether the pending question in the previous state is still the question
 * the user is looking at: the presenting commit is the last mutation of the planning
 * state, its assistant message is the latest message, and the semantic graph has not
 * moved. Every missing, malformed, or mismatching input fails closed.
 */
export function resolveWeeklyPlanningQuestionPresentationFreshness(params: {
  previousState: PlanningIntakeState | undefined;
  inputStateRevision: number | undefined;
  messages: readonly WeeklyPlanningMessage[];
  graphRevision: number;
}): WeeklyPlanningQuestionPresentationFreshness {
  const questionContext = params.previousState?.lastQuestionContext;
  if (!questionContext) return { status: 'no_question' };
  if (questionContext.presentation === undefined) return { status: 'unbound' };
  const presentation = decodeWeeklyPlanningQuestionPresentation(questionContext.presentation);
  if (!presentation) return { status: 'malformed' };
  if (!isNonNegativeInteger(params.inputStateRevision)) {
    return { status: 'stale', reason: 'input_revision_unknown' };
  }
  if (presentation.planningStateRevision !== params.inputStateRevision) {
    return { status: 'stale', reason: 'state_revision_mismatch' };
  }
  const latestMessage = params.messages.length > 0
    ? params.messages[params.messages.length - 1]
    : undefined;
  if (latestMessage?.role !== 'assistant'
    || latestMessage.id !== presentation.assistantMessageId) {
    return { status: 'stale', reason: 'latest_message_mismatch' };
  }
  if (presentation.graphRevision !== params.graphRevision) {
    return { status: 'stale', reason: 'graph_revision_mismatch' };
  }
  return { status: 'fresh', questionContext, presentation };
}
