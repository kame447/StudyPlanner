import type { AvailabilityDeclarationFactV5 } from './weeklyPlanningFactGraphV5';
import { listCalendarDatesInclusive } from './weeklyPlanningCalendarResolver';
import { resolveWeeklyPlanningCalendarRecurrenceDatesV5 } from './weeklyPlanningRecurrenceCalendarV5';
import {
  resolvedWeeklyPlanningDateExpressionForFactV5,
  type WeeklyPlanningResolvedDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';

export interface WeeklyPlanningDailyCapacityLimitV5 {
  date: string;
  maxMinutes: number;
  sourceFactIds: string[];
}

export type WeeklyPlanningDailyCapacityIssueCodeV5 =
  | 'invalid_daily_capacity_minutes'
  | 'invalid_daily_capacity_weekday'
  | 'unsupported_daily_capacity_date_expression'
  | 'missing_daily_capacity_date_scope';

export interface WeeklyPlanningDailyCapacityIssueV5 {
  code: WeeklyPlanningDailyCapacityIssueCodeV5;
  sourceFactId: string;
  blocking: true;
  details?: Record<string, string | number | boolean | null>;
}

export interface WeeklyPlanningDailyCapacityResolutionV5 {
  limits: WeeklyPlanningDailyCapacityLimitV5[];
  issues: WeeklyPlanningDailyCapacityIssueV5[];
}

function capacityDeclarations(
  declarations: ReadonlyArray<AvailabilityDeclarationFactV5>,
): AvailabilityDeclarationFactV5[] {
  return declarations.filter((declaration) => declaration.kind === 'capacity');
}

function recurrenceScope(params: {
  declaration: AvailabilityDeclarationFactV5;
  planningDates: readonly string[];
  issues: WeeklyPlanningDailyCapacityIssueV5[];
}): string[] | null {
  if (!params.declaration.recurrenceKind) return null;
  const resolved = resolveWeeklyPlanningCalendarRecurrenceDatesV5({
    kind: params.declaration.recurrenceKind,
    days: params.declaration.days,
    dates: params.planningDates,
  });
  for (const day of resolved.invalidDays) {
    params.issues.push({
      code: 'invalid_daily_capacity_weekday',
      sourceFactId: params.declaration.id,
      blocking: true,
      details: { day },
    });
  }
  return resolved.invalidDays.length > 0 ? [] : resolved.calendarDates;
}

function dateExpressionScope(params: {
  declaration: AvailabilityDeclarationFactV5;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
  planningDateSet: ReadonlySet<string>;
  issues: WeeklyPlanningDailyCapacityIssueV5[];
}): string[] | null {
  if (!params.declaration.dateExpression) return null;
  const resolved = resolvedWeeklyPlanningDateExpressionForFactV5({
    resolved: params.resolvedDateExpressions,
    factId: params.declaration.id,
  });
  if (!resolved || resolved.status !== 'resolved' || !resolved.range) {
    params.issues.push({
      code: 'unsupported_daily_capacity_date_expression',
      sourceFactId: params.declaration.id,
      blocking: true,
      details: {
        expression: params.declaration.dateExpression,
        resolutionStatus: resolved?.status ?? 'missing_resolved_snapshot',
      },
    });
    return [];
  }
  return (listCalendarDatesInclusive(resolved.range.start, resolved.range.end) ?? [])
    .filter((date) => params.planningDateSet.has(date));
}

function intersectScopes(
  recurrenceDates: string[] | null,
  expressionDates: string[] | null,
): string[] | null {
  if (recurrenceDates && expressionDates) {
    const expressionSet = new Set(expressionDates);
    return recurrenceDates.filter((date) => expressionSet.has(date));
  }
  return recurrenceDates ?? expressionDates;
}

export function resolveWeeklyPlanningDailyCapacitiesV5(params: {
  availabilityDeclarations: ReadonlyArray<AvailabilityDeclarationFactV5>;
  planningDates: readonly string[];
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
}): WeeklyPlanningDailyCapacityResolutionV5 {
  const issues: WeeklyPlanningDailyCapacityIssueV5[] = [];
  const planningDateSet = new Set(params.planningDates);
  const limitsByDate = new Map<string, WeeklyPlanningDailyCapacityLimitV5>();

  for (const declaration of capacityDeclarations(params.availabilityDeclarations)) {
    const maxMinutes = declaration.capacityMinutes;
    if (
      typeof maxMinutes !== 'number'
      || !Number.isFinite(maxMinutes)
      || maxMinutes <= 0
      || maxMinutes > 24 * 60
      || declaration.constraintLevel !== 'hard'
    ) {
      issues.push({
        code: 'invalid_daily_capacity_minutes',
        sourceFactId: declaration.id,
        blocking: true,
        details: {
          capacityMinutes: typeof maxMinutes === 'number' ? maxMinutes : null,
          constraintLevel: declaration.constraintLevel,
        },
      });
      continue;
    }

    const recurrenceDates = recurrenceScope({
      declaration,
      planningDates: params.planningDates,
      issues,
    });
    const expressionDates = dateExpressionScope({
      declaration,
      resolvedDateExpressions: params.resolvedDateExpressions,
      planningDateSet,
      issues,
    });
    const scopedDates = intersectScopes(recurrenceDates, expressionDates);
    if (scopedDates === null) {
      issues.push({
        code: 'missing_daily_capacity_date_scope',
        sourceFactId: declaration.id,
        blocking: true,
      });
      continue;
    }

    for (const date of scopedDates) {
      if (!planningDateSet.has(date)) continue;
      const prior = limitsByDate.get(date);
      if (!prior) {
        limitsByDate.set(date, {
          date,
          maxMinutes,
          sourceFactIds: [declaration.id],
        });
        continue;
      }
      limitsByDate.set(date, {
        date,
        maxMinutes: Math.min(prior.maxMinutes, maxMinutes),
        sourceFactIds: prior.sourceFactIds.includes(declaration.id)
          ? prior.sourceFactIds
          : [...prior.sourceFactIds, declaration.id],
      });
    }
  }

  return {
    limits: [...limitsByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    issues,
  };
}
