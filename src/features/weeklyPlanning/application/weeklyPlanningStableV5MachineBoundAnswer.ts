import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  isWeeklyPlanningQuestionPresentationDirect,
  resolveWeeklyPlanningQuestionPresentationFreshness,
} from '../intake/weeklyPlanningQuestionPresentation';
import { decodeWeeklyPlanningStableV5QuestionSlot } from '../intake/weeklyPlanningStableV5QuestionSlot';
import {
  decodeWeeklyPlanningMachineBoundEffortAnswerV5,
  formatWeeklyPlanningMachineBoundEffortAnswerV5,
  type WeeklyPlanningMachineBoundEffortAnswerV5,
} from '../semantic/weeklyPlanningMachineBoundAnswerV5';
import type { WeeklyPlanningMessage } from '../types';

export type WeeklyPlanningMachineBoundEffortQuestionV5 = Omit<
  WeeklyPlanningMachineBoundEffortAnswerV5, 'version' | 'kind' | 'minutes'
>;

/**
 * The presented question a typed effort control may bind to, from machine state only:
 * a fresh, directly presented single-target effort question with a resolved measurement.
 * Two-target, basis-qualified and controlled-candidate questions stay on their routes.
 */
export function resolveWeeklyPlanningMachineBoundEffortQuestionV5(params: {
  previousState: PlanningIntakeState | undefined;
  inputStateRevision: number | undefined;
  messages: readonly WeeklyPlanningMessage[];
  graphRevision: number;
}): WeeklyPlanningMachineBoundEffortQuestionV5 | null {
  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness(params);
  if (freshness.status !== 'fresh') return null;
  const { questionContext: context, presentation } = freshness;
  if (!isWeeklyPlanningQuestionPresentationDirect(presentation.content)
    || decodeWeeklyPlanningStableV5QuestionSlot(context.targetSlot) !== 'missing_effort_estimate'
    || (context.intent !== 'total_duration' && context.intent !== 'duration_per_unit')
    || typeof context.topicId !== 'string' || context.topicId.length === 0
    || context.estimateForWorkloadFactId !== undefined || context.questionBasis !== undefined
    || context.c5 !== undefined || context.controlledCandidate !== undefined) return null;
  return {
    assistantMessageId: presentation.assistantMessageId,
    questionActionId: context.actionId ?? null,
    targetFactId: context.topicId,
    graphRevision: params.graphRevision,
    effortMeasurement: context.intent,
  };
}

/**
 * Accepts the typed answer only when every bound identity equals the current question
 * and the turn text is exactly the label generated from the typed value. The comparison
 * is a consistency check; the text is never interpreted. Null keeps the AI route.
 */
export function verifyWeeklyPlanningMachineBoundEffortAnswerV5(params: {
  answer: unknown;
  userText: string;
  question: WeeklyPlanningMachineBoundEffortQuestionV5 | null;
}): WeeklyPlanningMachineBoundEffortAnswerV5 | null {
  const answer = decodeWeeklyPlanningMachineBoundEffortAnswerV5(params.answer);
  const question = params.question;
  if (!answer || !question) return null;
  if (answer.assistantMessageId !== question.assistantMessageId
    || answer.questionActionId !== question.questionActionId
    || answer.targetFactId !== question.targetFactId
    || answer.graphRevision !== question.graphRevision
    || answer.effortMeasurement !== question.effortMeasurement
    || params.userText !== formatWeeklyPlanningMachineBoundEffortAnswerV5(answer)) return null;
  return answer;
}
