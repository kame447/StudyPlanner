import type {
  SemanticAvailabilityRecurrenceKindV5,
  SemanticRecurrenceKindV5,
} from './weeklyPlanningSemanticTypesV5';
import { calendarWeekday } from './weeklyPlanningCalendarResolver';

export type WeeklyPlanningCalendarRecurrenceKindV5 =
  | SemanticRecurrenceKindV5
  | SemanticAvailabilityRecurrenceKindV5;

export interface WeeklyPlanningCalendarRecurrenceResolutionV5 {
  calendarDates: string[] | null;
  invalidDays: string[];
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function datesForWeekdayIndexes(
  dates: readonly string[],
  indexes: ReadonlySet<number>,
): string[] {
  return dates.filter((date) => {
    const weekday = calendarWeekday(date);
    return weekday !== null && indexes.has(weekday);
  });
}

function explicitWeekdayScope(params: {
  dates: readonly string[];
  days: readonly string[];
}): WeeklyPlanningCalendarRecurrenceResolutionV5 {
  if (params.days.length === 0) {
    return { calendarDates: null, invalidDays: [] };
  }

  const indexes = new Set<number>();
  const invalidDays: string[] = [];
  for (const day of params.days) {
    const index = WEEKDAY_INDEX[day];
    if (index === undefined) {
      if (!invalidDays.includes(day)) invalidDays.push(day);
      continue;
    }
    indexes.add(index);
  }

  return {
    calendarDates: indexes.size === 0
      ? null
      : datesForWeekdayIndexes(params.dates, indexes),
    invalidDays,
  };
}

export function resolveWeeklyPlanningCalendarRecurrenceDatesV5(params: {
  kind: WeeklyPlanningCalendarRecurrenceKindV5;
  days: readonly string[];
  dates: readonly string[];
}): WeeklyPlanningCalendarRecurrenceResolutionV5 {
  if (params.kind === 'daily') {
    return { calendarDates: [...params.dates], invalidDays: [] };
  }
  if (params.kind === 'weekdays') {
    return {
      calendarDates: datesForWeekdayIndexes(params.dates, new Set([1, 2, 3, 4, 5])),
      invalidDays: [],
    };
  }
  if (params.kind === 'weekends') {
    return {
      calendarDates: datesForWeekdayIndexes(params.dates, new Set([0, 6])),
      invalidDays: [],
    };
  }
  if (params.kind === 'times_per_week') {
    return { calendarDates: null, invalidDays: [] };
  }

  return explicitWeekdayScope({ dates: params.dates, days: params.days });
}

export function isWeeklyPlanningCalendarExpandableRecurrenceV5(params: {
  kind: WeeklyPlanningCalendarRecurrenceKindV5;
  days: readonly string[];
}): boolean {
  if (
    params.kind === 'daily'
    || params.kind === 'weekdays'
    || params.kind === 'weekends'
  ) {
    return true;
  }
  if (params.kind === 'times_per_week') return false;
  const resolution = explicitWeekdayScope({ dates: [], days: params.days });
  return resolution.calendarDates !== null && resolution.invalidDays.length === 0;
}
