import type { WeeklyPlanningTraceResponseSource } from './weeklyPlanningTraceTypes';
import {
  createWeeklyPlanningTurnDiagnosticV2 as createBaseWeeklyPlanningTurnDiagnosticV2,
} from './weeklyPlanningTurnDiagnosticV2';

type BaseCreateInput = Parameters<typeof createBaseWeeklyPlanningTurnDiagnosticV2>[0];

export type CreateWeeklyPlanningTurnDiagnosticV2WithResponseSourceInput = BaseCreateInput & {
  responseSource?: WeeklyPlanningTraceResponseSource;
};

export function createWeeklyPlanningTurnDiagnosticV2(
  input: CreateWeeklyPlanningTurnDiagnosticV2WithResponseSourceInput,
): ReturnType<typeof createBaseWeeklyPlanningTurnDiagnosticV2> {
  const { responseSource, ...baseInput } = input;
  const entry = createBaseWeeklyPlanningTurnDiagnosticV2(baseInput);
  if (!responseSource) return entry;
  return {
    ...entry,
    assistantOutput: {
      ...entry.assistantOutput,
      responseSource,
    },
  };
}
