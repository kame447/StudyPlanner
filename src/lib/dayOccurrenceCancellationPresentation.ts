import type { MonthEvent, Plan } from '../types/domain';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { addDays, formatDateLabel } from './date';

type CancellationSource = Pick<Plan, 'repeat' | 'recurrenceRules'> | Pick<MonthEvent, 'repeat'>;

function hasRepeatedOccurrences(source?: CancellationSource): boolean {
  if (!source) return false;
  if ('recurrenceRules' in source && source.recurrenceRules.length > 0) {
    return source.recurrenceRules.some(rule => rule.kind !== 'date')
      || new Set(source.recurrenceRules.flatMap(rule => rule.dates)).size > 1;
  }
  return source.repeat !== 'none';
}

export function dayOccurrenceCancellationPresentation(occurrence: ScheduleOccurrence, source?: CancellationSource) {
  const isRecurring = occurrence.source.kind === 'timetable' || hasRepeatedOccurrences(source);
  const crossesDays = occurrence.start.date !== occurrence.end.date
    && !(occurrence.end.time === '00:00' && occurrence.end.date === addDays(occurrence.start.date, 1));
  const range = `${formatDateLabel(occurrence.start.date)} ${occurrence.start.time} - ${formatDateLabel(occurrence.end.date)} ${occurrence.end.time}`;
  return {
    isRecurring,
    label: !isRecurring ? '予定を削除' : crossesDays ? 'この回だけ削除' : 'この日だけ削除',
    description: crossesDays
      ? isRecurring
        ? `${range}。開始から終了まで、この回全体が削除対象です。別の回と記録は残ります。`
        : `${range}。開始から終了まで、この予定全体が削除対象です。記録は残ります。`
      : undefined,
  };
}
