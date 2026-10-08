import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { addDays, formatDateLabel } from './date';

export function dayOccurrenceCancellationPresentation(occurrence: ScheduleOccurrence) {
  const crossesDays = occurrence.start.date !== occurrence.end.date
    && !(occurrence.end.time === '00:00' && occurrence.end.date === addDays(occurrence.start.date, 1));
  const range = `${formatDateLabel(occurrence.start.date)} ${occurrence.start.time} - ${formatDateLabel(occurrence.end.date)} ${occurrence.end.time}`;
  return {
    label: crossesDays ? 'この回だけ削除' : 'この日だけ削除',
    description: crossesDays ? `${range}。開始から終了まで、この回全体が削除対象です。別の回と記録は残ります。` : undefined,
  };
}
