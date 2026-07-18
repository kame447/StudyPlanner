import { addDays } from '../../../lib/date';

export type WeeklyPlanningWeekStartsOn = 'monday' | 'sunday';

function localWeekday(dateString: string): number {
  return new Date(`${dateString}T00:00:00`).getDay();
}

export function startOfWeeklyPlanningWeek(
  dateString: string,
  weekStartsOn: WeeklyPlanningWeekStartsOn = 'monday',
): string {
  const weekday = localWeekday(dateString);
  const startWeekday = weekStartsOn === 'sunday' ? 0 : 1;
  const daysSinceStart = (weekday - startWeekday + 7) % 7;
  return addDays(dateString, -daysSinceStart);
}

export function endOfWeeklyPlanningWeek(
  dateString: string,
  weekStartsOn: WeeklyPlanningWeekStartsOn = 'monday',
): string {
  return addDays(startOfWeeklyPlanningWeek(dateString, weekStartsOn), 6);
}

export function nextWeekdayOnOrAfter(dateString: string, weekday: number): string {
  const current = localWeekday(dateString);
  return addDays(dateString, (weekday - current + 7) % 7);
}

export function resolveWeekendRange(dateString: string): {
  startDate: string;
  endDate: string;
} {
  const weekday = localWeekday(dateString);
  if (weekday === 0) {
    return { startDate: dateString, endDate: dateString };
  }
  const saturday = nextWeekdayOnOrAfter(dateString, 6);
  return { startDate: saturday, endDate: addDays(saturday, 1) };
}
