import type {
  ScheduleTemplate,
  TimetableAlternatingWeek,
  TimetablePeriodDraft,
} from '../types/domain';
import { timetableTimeToMinutes } from './timetableTime';

type PeriodTime = Pick<TimetablePeriodDraft, 'startTime' | 'endTime'>;
type NumberedPeriod = PeriodTime & Pick<TimetablePeriodDraft, 'periodNumber'>;

function getTimeKey(startTime: string | null, endTime: string | null): string | null {
  return startTime && endTime ? `${startTime}-${endTime}` : null;
}

function hasCompletePeriodTime(period: PeriodTime): period is PeriodTime & {
  startTime: string;
  endTime: string;
} {
  return Boolean(period.startTime && period.endTime);
}

export function hasValidPeriodTime<Period extends PeriodTime>(period: Period): period is Period & {
  startTime: string;
  endTime: string;
} {
  return hasCompletePeriodTime(period) &&
    timetableTimeToMinutes(period.endTime) > timetableTimeToMinutes(period.startTime);
}

export function getPeriodTimeStatus(period: PeriodTime): 'valid' | 'partial' | 'invalid' {
  if (!hasCompletePeriodTime(period)) {
    return 'partial';
  }

  return hasValidPeriodTime(period) ? 'valid' : 'invalid';
}

export function findPeriodNumberForTemplate(
  template: Pick<ScheduleTemplate, 'periodNumber' | 'startTime' | 'endTime'>,
  periods: readonly NumberedPeriod[],
): number | null {
  if (template.periodNumber && periods.some((period) => period.periodNumber === template.periodNumber)) {
    return template.periodNumber;
  }

  const timeMatch = periods.find(
    (period) => getTimeKey(period.startTime, period.endTime) === getTimeKey(template.startTime, template.endTime),
  );

  if (timeMatch) {
    return timeMatch.periodNumber;
  }

  const validPeriods = periods.filter(hasValidPeriodTime);

  if (validPeriods.length === 0) {
    return null;
  }

  const templateStartMinutes = timetableTimeToMinutes(template.startTime);
  // Stable sorting preserves the caller's order when start times are equally close.
  return validPeriods
    .slice()
    .sort(
      (left, right) =>
        Math.abs(timetableTimeToMinutes(left.startTime) - templateStartMinutes) -
        Math.abs(timetableTimeToMinutes(right.startTime) - templateStartMinutes),
    )[0].periodNumber;
}

export function templateVisibleInAlternatingWeek(
  template: Pick<ScheduleTemplate, 'alternatingWeek'>,
  usesAlternatingWeeks: boolean,
  week: TimetableAlternatingWeek,
): boolean {
  if (!usesAlternatingWeeks) {
    return true;
  }

  const scope = template.alternatingWeek ?? 'both';
  return scope === 'both' || scope === week;
}
