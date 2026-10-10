import {
  resolveCanonicalDateExpression,
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
  canonicalWeekdayIndex,
  calendarWeekday,
  listCalendarDatesInclusive,
  type CalendarDateExpressionResolution,
  type CalendarDateRange,
  type CalendarWeekStartsOn,
} from './weeklyPlanningCalendarResolver';

export interface WeeklyPlanningDateExpressionGraphViewV5 {
  readonly temporalConstraints?: ReadonlyArray<{
    id: string;
    dateExpression: string | null;
    kind?: string;
    constraintLevel?: string;
  }>;
  readonly taskDateRules?: ReadonlyArray<{
    id: string;
    dateExpression: string;
    kind?: string;
    constraintLevel?: string;
  }>;
  readonly availabilityDeclarations?: ReadonlyArray<{
    id: string;
    dateExpression: string | null;
    kind?: string;
    constraintLevel?: string;
    recurrenceKind?: string | null;
  }>;
}

export interface WeeklyPlanningResolvedDateExpressionV5 {
  factId: string;
  expression: string;
  status: CalendarDateExpressionResolution['status'];
  range: CalendarDateRange | null;
  /** Discrete eligibility dates: never expand the enclosing range between weekdays. */
  dates?: string[];
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
  planningWindow?: { startDate: string; endDate: string } | null;
}): WeeklyPlanningResolvedDateExpressionsV5 {
  const weekStartsOn = params.weekStartsOn ?? 'monday';
  const hardBoundIds = new Set((params.graph.temporalConstraints ?? [])
    .filter(fact => fact.constraintLevel === 'hard'
      && ['deadline', 'latest_end', 'earliest_start'].includes(fact.kind ?? ''))
    .map(fact => fact.id));
  const dateRuleIds = new Set((params.graph.taskDateRules ?? [])
    .filter(fact => fact.constraintLevel === 'hard'
      && ['allowed_date', 'excluded_date'].includes(fact.kind ?? ''))
    .map(fact => fact.id));
  const preferredDateIds = new Set([
    ...(params.graph.temporalConstraints ?? [])
      .filter((fact) => fact.kind === 'preferred_window')
      .map((fact) => fact.id),
    ...(params.graph.availabilityDeclarations ?? [])
      .filter((fact) => fact.recurrenceKind === null
        && (fact.kind === 'preferred' || (fact.kind === 'available' && fact.constraintLevel === 'soft')))
      .map((fact) => fact.id),
  ]);
  const planningDates = params.planningWindow
    ? listCalendarDatesInclusive(params.planningWindow.startDate, params.planningWindow.endDate)
    : null;
  return {
    referenceDate: params.currentDate,
    weekStartsOn,
    facts: dateExpressionFacts(params.graph).map((fact) => {
      const resolution = resolveCanonicalDateExpression({
        expression: fact.dateExpression,
        currentDate: params.currentDate,
        weekStartsOn,
      });
      const isWindowWeekday = planningDates !== null
        && resolution.status === 'resolved'
        && (CANONICAL_WEEKDAY_DATE_EXPRESSIONS as readonly string[]).includes(fact.dateExpression)
        && (hardBoundIds.has(fact.id) || dateRuleIds.has(fact.id) || preferredDateIds.has(fact.id));
      if (isWindowWeekday) {
        const dates = planningDates.filter(date =>
          calendarWeekday(date) === canonicalWeekdayIndex(fact.dateExpression));
        // A short window without this weekday needs resolution rather than dropping a hard fact.
        if (dates.length === 0) {
          // Soft scope diagnostics retain the resolved expression; the compiler asks
          // only when this weekday has no occurrence in the accepted period.
          return {
            factId: fact.id, expression: fact.dateExpression,
            status: preferredDateIds.has(fact.id) ? resolution.status : 'unsupported_expression' as const,
            range: preferredDateIds.has(fact.id) ? resolution.range : null,
          };
        }
        const originalDate = resolution.range.start;
        const selectedDate = dates.includes(originalDate) ? originalDate : dates[0];
        return {
          factId: fact.id,
          expression: fact.dateExpression,
          status: resolution.status,
          range: dateRuleIds.has(fact.id) || preferredDateIds.has(fact.id)
            ? { start: dates[0], end: dates[dates.length - 1] }
            : { start: selectedDate, end: selectedDate },
          ...((dateRuleIds.has(fact.id) || preferredDateIds.has(fact.id)) ? { dates } : {}),
        };
      }
      return {
        factId: fact.id,
        expression: fact.dateExpression,
        status: resolution.status,
        range: resolution.range,
      };
    }),
  };
}

export function resolvedWeeklyPlanningDateExpressionForFactV5(params: {
  resolved: WeeklyPlanningResolvedDateExpressionsV5;
  factId: string;
}): WeeklyPlanningResolvedDateExpressionV5 | undefined {
  return params.resolved.facts.find((fact) => fact.factId === params.factId);
}
