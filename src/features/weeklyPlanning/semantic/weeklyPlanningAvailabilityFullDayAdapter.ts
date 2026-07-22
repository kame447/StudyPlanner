import type { WeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import {
  resolveWeeklyPlanningAvailability,
  type AvailabilityResolutionContext,
  type AvailabilityResolutionResult,
  type ExternalConstraintSourceSnapshot,
} from './weeklyPlanningAvailabilityResolver';

function isWholeDayUnavailableDeclaration(
  declaration: WeeklyPlanningFactGraphV2['availabilityDeclarations'][number],
): boolean {
  return declaration.kind === 'unavailable'
    && declaration.constraintLevel === 'hard'
    && declaration.namedTimePeriod === null
    && declaration.startTime === null
    && declaration.endTime === null
    && Boolean(declaration.dateExpression || declaration.recurrenceKind);
}

export function resolveWeeklyPlanningAvailabilityWithFullDayRules(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: AvailabilityResolutionContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
}): AvailabilityResolutionResult {
  const graph: WeeklyPlanningFactGraphV2 = {
    ...params.graph,
    availabilityDeclarations: params.graph.availabilityDeclarations.map((declaration) =>
      isWholeDayUnavailableDeclaration(declaration)
        ? {
            ...declaration,
            startTime: '00:00',
            endTime: '24:00',
          }
        : declaration),
  };
  return resolveWeeklyPlanningAvailability({
    graph,
    context: params.context,
    externalSources: params.externalSources,
  });
}
