import type { AiInputMode, WeeklyPlanningMessage } from '../features/weeklyPlanning/types';
import type { PlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeTypes';

export function resolveInitialAiInputMode(params: {
  messages: readonly WeeklyPlanningMessage[] | undefined;
  intakeState: PlanningIntakeState | null | undefined;
}): AiInputMode {
  return (params.messages?.length ?? 0) > 0 || params.intakeState
    ? 'weekly_planning'
    : 'chat';
}
