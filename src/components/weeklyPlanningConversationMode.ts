import type {
  AiInputMode,
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from '../features/weeklyPlanning/types';
import type { PlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeTypes';

export interface WeeklyPlanningSessionPresence {
  messages: readonly WeeklyPlanningMessage[] | undefined;
  intakeState: PlanningIntakeState | null | undefined;
  draftBlockCount?: number;
  pendingTurn?: WeeklyPlanningPendingTurn;
  pendingApproval?: WeeklyPlanningPendingApproval;
}

export function hasWeeklyPlanningSession(
  params: WeeklyPlanningSessionPresence,
): boolean {
  return (params.messages?.length ?? 0) > 0
    || Boolean(params.intakeState)
    || (params.draftBlockCount ?? 0) > 0
    || Boolean(params.pendingTurn)
    || Boolean(params.pendingApproval);
}

export function resolveInitialAiInputMode(
  params: WeeklyPlanningSessionPresence,
): AiInputMode {
  return hasWeeklyPlanningSession(params) ? 'weekly_planning' : 'chat';
}

export function resolveInitialQuickEntryInputMethod(
  params: WeeklyPlanningSessionPresence,
): 'ai' | 'manual' {
  return hasWeeklyPlanningSession(params) ? 'ai' : 'manual';
}
