import {
  resolveCanonicalDateExpression,
  type CalendarDateExpressionResolution,
  type CalendarDateRange,
  type CalendarWeekStartsOn,
} from './weeklyPlanningCalendarResolver';

export interface WeeklyPlanningDateExpressionGraphViewV5 {
  readonly temporalConstraints?: ReadonlyArray<{
    id: string;
    dateExpression: string | null;
  }>;
  readonly taskDateRules?: ReadonlyArray<{
    id: string;
    dateExpression: string;
  }>;
  readonly availabilityDeclarations?: ReadonlyArray<{
    id: string;
    dateExpression: string | null;
  }>;
}

export interface WeeklyPlanningResolvedDateExpressionV5 {
  factId: string;
  expression: string;
  status: CalendarDateExpressionResolution['status'];
  range: CalendarDateRange | null;
}

export interface WeeklyPlanningResolvedDateExpressionsV5 {
  referenceDate: string;
  weekStartsOn: CalendarWeekStartsOn;
  facts: WeeklyPlanningResolvedDateExpressionV5[];
}

function dateExpressionFacts(
  graph: WeeklyPlanningDateExpressionGraphViewV5,
): Array<{ id: string; dateExpression: string }> {
  const facts = [
    ...(graph.temporalConstraints ?? []),
    ...(graph.taskDateRules ?? []),
    ...(graph.availabilityDeclarations ?? []),
  ];
  const byId = new Map<string, { id: string; dateExpression: string }>();
  for (const fact of facts) {
    if (!fact.dateExpression || byId.has(fact.id)) continue;
    byId.set(fact.id, { id: fact.id, dateExpression: fact.dateExpression });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveWeeklyPlanningDateExpressionsV5(params: {
  graph: WeeklyPlanningDateExpressionGraphViewV5;
  currentDate: string;
  weekStartsOn?: CalendarWeekStartsOn;
}): WeeklyPlanningResolvedDateExpressionsV5 {
  const weekStartsOn = params.weekStartsOn ?? 'monday';
  return {
    referenceDate: params.currentDate,
    weekStartsOn,
    facts: dateExpressionFacts(params.graph).map((fact) => {
      const resolution = resolveCanonicalDateExpression({
        expression: fact.dateExpression,
        currentDate: params.currentDate,
        weekStartsOn,
      });
      return {
        factId: fact.id,
        expression: fact.dateExpression,
        status: resolution.status,
        range: resolution.range,
      };
    }),
  };
}

export function resolveWeeklyPlanningSingleDateExpressionV5(params: {
  factId: string;
  expression: string;
  currentDate: string;
  weekStartsOn?: CalendarWeekStartsOn;
}): WeeklyPlanningResolvedDateExpressionV5 {
  const resolved = resolveWeeklyPlanningDateExpressionsV5({
    graph: {
      taskDateRules: [{ id: params.factId, dateExpression: params.expression }],
    },
    currentDate: params.currentDate,
    weekStartsOn: params.weekStartsOn,
  });
  return resolved.facts[0];
}

export function resolvedWeeklyPlanningDateExpressionForFactV5(params: {
  resolved: WeeklyPlanningResolvedDateExpressionsV5;
  factId: string;
}): WeeklyPlanningResolvedDateExpressionV5 | undefined {
  return params.resolved.facts.find((fact) => fact.factId === params.factId);
}
