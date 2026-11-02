import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextFocusedInterpreter } from './weeklyPlanningVNextFocusedInterpreter';
import { createWeeklyPlanningVNextOptionChoiceInterpreter, type WeeklyPlanningVNextOptionChoicePort } from './weeklyPlanningVNextOptionChoice';

/** One frozen composition for browser and durable execution. Only the closed-choice transport and the
 * focused request identity (durable replay needs identical bytes) vary. No browser dependency may enter here.
 */
export function createWeeklyPlanningVNextRuntimeInterpreter(
  scope: { ownerId: string; conversationId: string },
  options: { choice: WeeklyPlanningVNextOptionChoicePort; focusedRequestId?: () => string },
) {
  return createWeeklyPlanningVNextOptionChoiceInterpreter({ scope, choice: options.choice,
    fullReading: createWeeklyPlanningVNextFocusedInterpreter({ fullReading: createWeeklyPlanningVNextProviderInterpreter(),
      requestId: options.focusedRequestId }) });
}

export const VNEXT_OPTION_CHOICE_POLICY: WeeklyPlanningVNextOptionChoicePort['policy'] = {
  id: 'vnext-frozen-dev', calibrationEvidenceId: 'vnext-dev-frozen-a25c9899', rules: [
    { menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 0.91, minimumMargin: 0.82 },
    { menuKind: 'leaves', optionCount: 4, depth: 0, minimumTopProbability: 0.59, minimumMargin: 0.20 },
  ],
};
export const VNEXT_OPTION_CHOICE_SEMANTIC_POLICY = {
  calibrationEvidenceId: 'vnext-dev-frozen-a25c9899', maximumConditionChange: 0.36, maximumIndependentMeaning: 0.69,
};
