import {
  createWeeklyPlanningDialogueDecision as createCoreDialogueDecision,
} from './weeklyPlanningDialogueManagerCore';
import type {
  WeeklyPlanningDialogueDecisionInput,
} from './weeklyPlanningDialogueManagerCore';
import type {
  WeeklyPlanningDialogueDecision,
} from './weeklyPlanningClarificationDecision';

export {
  createMissingQuestionPlan,
} from './weeklyPlanningDialogueManagerCore';
export type {
  WeeklyPlanningDialogueDecisionKind,
  WeeklyPlanningDialogueDecisionSummary,
  WeeklyPlanningQuestionPlanKind,
  WeeklyPlanningQuestionPlanItem,
  WeeklyPlanningDialogueDecisionInput,
} from './weeklyPlanningDialogueManagerCore';
export {
  createWeeklyPlanningClarificationDecision,
} from './weeklyPlanningClarificationDecision';
export type {
  WeeklyPlanningDialogueDecision,
} from './weeklyPlanningClarificationDecision';

export function createWeeklyPlanningDialogueDecision(
  input: WeeklyPlanningDialogueDecisionInput,
): WeeklyPlanningDialogueDecision {
  return createCoreDialogueDecision(input);
}
