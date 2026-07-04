import type { PlanningIntakeMissing } from '../intake/weeklyPlanningIntakeTypes';
import { parseBareDurationAsUnitRateCommand } from '../intake/weeklyPlanningUnitRateParsing';

export interface WeeklyPlanningInterpreterEscalationInput {
  deterministicCommandCount: number;
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

  if (input.deterministicCommandCount > 0 && missingWasReduced(input.missingBefore, input.missingAfter)) {
    return false;
  }

  if (input.deterministicCommandCount > 0 && input.missingBefore.length === 0) {
    return false;
  }

  return input.deterministicCommandCount === 0 || !missingWasReduced(input.missingBefore, input.missingAfter);
}
