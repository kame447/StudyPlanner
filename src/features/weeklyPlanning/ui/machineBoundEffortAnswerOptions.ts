import { resolveWeeklyPlanningMachineBoundEffortQuestionV5 } from '../application/weeklyPlanningMachineBoundEffortQuestion';
import {
  formatWeeklyPlanningMachineBoundEffortAnswerV5,
  MACHINE_BOUND_EFFORT_ANSWER_MINUTES_V5,
  type WeeklyPlanningMachineBoundEffortAnswerV5,
} from '../semantic/weeklyPlanningMachineBoundAnswerV5';
import type { PlanningState } from '../types';

/** #735 draft: typed answer chips stay hidden until a product decision enables them. */
export const machineBoundEffortAnswerEnabled = () =>
  import.meta.env.VITE_WEEKLY_PLANNING_TYPED_EFFORT_ANSWER === 'enabled';

export interface MachineBoundEffortAnswerOption {
  label: string;
  answer: WeeklyPlanningMachineBoundEffortAnswerV5;
}

/**
 * Chips for the question card of the latest assistant message, from machine state only.
 * The server re-verifies the same binding against its committed graph before use.
 */
export function buildMachineBoundEffortAnswerOptions(
  state: PlanningState,
  enabled = machineBoundEffortAnswerEnabled(),
): MachineBoundEffortAnswerOption[] {
  const graphRevision = state.intakeState?.lastQuestionContext?.presentation?.graphRevision;
  if (!enabled || state.pendingTurn || state.pendingApproval || state.approvalRecovery
    || graphRevision === undefined) return [];
  const question = resolveWeeklyPlanningMachineBoundEffortQuestionV5({
    previousState: state.intakeState,
    inputStateRevision: state.revision,
    messages: state.messages,
    graphRevision,
  });
  if (!question) return [];
  return MACHINE_BOUND_EFFORT_ANSWER_MINUTES_V5[question.effortMeasurement].map((minutes) => {
    const answer: WeeklyPlanningMachineBoundEffortAnswerV5 = {
      version: 1, kind: 'effort_duration', ...question, minutes,
    };
    return { label: formatWeeklyPlanningMachineBoundEffortAnswerV5(answer), answer };
  });
}
