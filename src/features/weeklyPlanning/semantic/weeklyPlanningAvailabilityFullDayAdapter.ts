import type { AvailabilityDeclarationFact } from './weeklyPlanningFactGraphV2';
import {
  resolveWeeklyPlanningAvailability,
  type AvailabilityResolutionContext,
  type AvailabilityResolutionResult,
  type ExternalConstraintSourceSnapshot,
  type WeeklyPlanningAvailabilityGraphView,
} from './weeklyPlanningAvailabilityResolver';
import type {
  WeeklyPlanningResolvedDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';

const RESOLVER_WEEKDAY_KEY_BY_CANONICAL: Readonly<Record<string, string>> = {
  'weekday:sunday': 'sun',
  'weekday:monday': 'mon',
  'weekday:tuesday': 'tue',
  'weekday:wednesday': 'wed',
  'weekday:thursday': 'thu',
  'weekday:friday': 'fri',
  'weekday:saturday': 'sat',
};

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

function adaptAvailabilityDeclarationForResolver(
  declaration: AvailabilityDeclarationFact,
): AvailabilityDeclarationFact {
  const normalizedDays = declaration.days.map(
    (day) => RESOLVER_WEEKDAY_KEY_BY_CANONICAL[day] ?? day,
  );

  if (isWholeDayUnavailableDeclaration(declaration)) {
    return {
      ...declaration,
      days: normalizedDays,
      startTime: '00:00',
      endTime: '24:00',
    };
  }

  return {
    ...declaration,
    days: normalizedDays,
  };
}

export function resolveWeeklyPlanningAvailabilityWithFullDayRules(params: {
  graph: WeeklyPlanningAvailabilityGraphView;
  context: AvailabilityResolutionContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
  resolvedDateExpressions?: WeeklyPlanningResolvedDateExpressionsV5;
}): AvailabilityResolutionResult {
  const graph: WeeklyPlanningAvailabilityGraphView = {
    revision: params.graph.revision,
    availabilityDeclarations: params.graph.availabilityDeclarations.map(
      adaptAvailabilityDeclarationForResolver,
    ),
    constraintSourceRequests: params.graph.constraintSourceRequests,
  };
  return resolveWeeklyPlanningAvailability({
    graph,
    context: params.context,
    externalSources: params.externalSources,
    resolvedDateExpressions: params.resolvedDateExpressions,
  });
}
