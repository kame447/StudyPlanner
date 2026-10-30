import { findPeriodNumberForTemplate, getPeriodTimeStatus, templateVisibleInAlternatingWeek } from './timetableViewModel';
import type { RecurrenceWeekday, ScheduleTemplate, TimetablePeriod, TimetablePeriodDraft, TimetableTerm } from '../types/domain';

/** Header and loading scaffold use the same compact dates; sheets retain full dates. */
export function formatTimetablePeriodRange(term: TimetableTerm | null, compact = false): string {
  if (!term?.startDate && !term?.endDate) return '期間未設定';
  if (!compact) return `${term.startDate ?? '開始日未設定'} 〜 ${term.endDate ?? '終了日未設定'}`;
  const dateLabel = (value: string | null | undefined, unset: string) => {
    if (!value) return unset;
    const [year, month, day] = value.split('-').map(Number);
    const yearLabel = year === term.year ? '' : year === term.year + 1 ? '翌' : `${year}/`;
    return `${yearLabel}${month}/${day}`;
  };
  return `${dateLabel(term.startDate, '開始日未設定')}〜${dateLabel(term.endDate, '終了日未設定')}`;
}

export type DisplayPeriod = TimetablePeriodDraft & {
  id?: string;
};

export const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
];

export const DEFAULT_PERIODS: DisplayPeriod[] = [
  { userId: '', termId: 'default', periodNumber: 1, label: '1', startTime: '08:40', endTime: '10:10' },
  { userId: '', termId: 'default', periodNumber: 2, label: '2', startTime: '10:20', endTime: '11:50' },
  { userId: '', termId: 'default', periodNumber: 3, label: '3', startTime: '12:45', endTime: '14:15' },
  { userId: '', termId: 'default', periodNumber: 4, label: '4', startTime: '14:25', endTime: '15:55' },
  { userId: '', termId: 'default', periodNumber: 5, label: '5', startTime: '16:05', endTime: '17:35' },
  { userId: '', termId: 'default', periodNumber: 6, label: '6', startTime: '18:00', endTime: '19:30' },
];

export interface TimetableDisplayInput {
  userId: string;
  activeTermId: string;
  timetablePeriods: readonly TimetablePeriod[];
  scheduleTemplates: readonly ScheduleTemplate[];
  usesAlternatingWeeks?: boolean;
}

/** The loaded grid and its loading scaffold share the same row selection. */
export function buildTimetableDisplayModel({ userId, activeTermId, timetablePeriods, scheduleTemplates, usesAlternatingWeeks = false }: TimetableDisplayInput) {
  const savedPeriodsForTerm = timetablePeriods
    .filter(period => period.termId === activeTermId)
    .map(period => ({ ...period }))
    .sort((left, right) => left.periodNumber - right.periodNumber);
  const termTemplates = scheduleTemplates.filter(template => (template.termId || 'default') === activeTermId);
  const basePeriods = savedPeriodsForTerm.length > 0
    ? savedPeriodsForTerm
    : DEFAULT_PERIODS.map(period => ({ ...period, userId, termId: activeTermId }));
  const periods = new Map<number, DisplayPeriod>();
  basePeriods.forEach(period => { periods.set(period.periodNumber, period); });
  termTemplates.forEach(template => {
    if (template.periodNumber && !periods.has(template.periodNumber)) {
      periods.set(template.periodNumber, {
        userId,
        termId: activeTermId,
        periodNumber: template.periodNumber,
        label: String(template.periodNumber),
        startTime: template.startTime,
        endTime: template.endTime,
      });
    }
  });
  const displayPeriods = Array.from(periods.values()).sort((left, right) => left.periodNumber - right.periodNumber);
  // Reserve the larger A/B stack once so switching weeks and loading cannot
  // resize a row. Alternative-week cards are not incorrectly added together.
  const rowMinimumCardCounts = displayPeriods.map(period => Math.max(1, ...WEEKDAY_OPTIONS.flatMap(day =>
    (['a', 'b'] as const).map(week => termTemplates.filter(template => template.weekday === day.value
      && findPeriodNumberForTemplate(template, displayPeriods) === period.periodNumber
      && templateVisibleInAlternatingWeek(template, usesAlternatingWeeks, week)).length),
  )));
  return {
    savedPeriodsForTerm,
    termTemplates,
    displayPeriods,
    rowMinimumCardCounts,
    gridRows: `auto ${rowMinimumCardCounts.map((count, index) => `minmax(${Math.max(count * 4, getPeriodTimeStatus(displayPeriods[index]) === 'valid' ? 4 : 5)}rem, 1fr)`).join(' ')}`,
  };
}
