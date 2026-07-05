import type { PlanningIntakeMissing } from '../intake/weeklyPlanningIntakeTypes';
import { parseBareDurationAsUnitRateCommand } from '../intake/weeklyPlanningUnitRateParsing';

export interface WeeklyPlanningInterpreterEscalationInput {
  deterministicCommandCount: number;
  fallbackProgressCount?: number;
  missingBefore: PlanningIntakeMissing[];
  missingAfter: PlanningIntakeMissing[];
  userText: string;
  hasInterpreter: boolean;
}

function missingWasReduced(before: PlanningIntakeMissing[], after: PlanningIntakeMissing[]): boolean {
  return before.some((item) => !after.includes(item));
}

export function shouldEscalateToInterpreter(
  input: WeeklyPlanningInterpreterEscalationInput,
): boolean {
  if (!input.hasInterpreter) {
    return false;
  }

  if (parseBareDurationAsUnitRateCommand(input.userText)) {
    return false;
  }

  const madeProgress = input.deterministicCommandCount > 0 || (input.fallbackProgressCount ?? 0) > 0;

  if (madeProgress && missingWasReduced(input.missingBefore, input.missingAfter)) {
    return false;
  }

  if (madeProgress && input.missingBefore.length === 0) {
    return false;
  }

  return !madeProgress || !missingWasReduced(input.missingBefore, input.missingAfter);
}
