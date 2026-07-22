import type { AvailabilityDeclarationFact } from './weeklyPlanningFactGraphV2';
import {
  resolveWeeklyPlanningAvailability,
  type AvailabilityResolutionContext,
  type AvailabilityResolutionResult,
  type ExternalConstraintSourceSnapshot,
  type WeeklyPlanningAvailabilityGraphView,
} from './weeklyPlanningAvailabilityResolver';

function isWholeDayUnavailableDeclaration(
  declaration: AvailabilityDeclarationFact,
): boolean {
  return declaration.kind === 'unavailable'
    && declaration.constraintLevel === 'hard'
    && declaration.namedTimePeriod === null
    && declaration.startTime === null
    && declaration.endTime === null
    && Boolean(declaration.dateExpression || declaration.recurrenceKind);
}

export function resolveWeeklyPlanningAvailabilityWithFullDayRules(params: {
  graph: WeeklyPlanningAvailabilityGraphView;
  context: AvailabilityResolutionContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
}): AvailabilityResolutionResult {
  const graph: WeeklyPlanningAvailabilityGraphView = {
    revision: params.graph.revision,
    availabilityDeclarations: params.graph.availabilityDeclarations.map((declaration) =>
      isWholeDayUnavailableDeclaration(declaration)
        ? {
            ...declaration,
            startTime: '00:00',
            endTime: '24:00',
          }
        : declaration),
    constraintSourceRequests: params.graph.constraintSourceRequests,
  };
  return resolveWeeklyPlanningAvailability({
    graph,
    context: params.context,
    externalSources: params.externalSources,
  });
}
