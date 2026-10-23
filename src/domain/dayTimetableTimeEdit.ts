import { minutesBetween } from '../lib/date';
import { getRecurrenceWeekday } from '../lib/planRecurrence';
import { resolveTimetableTermForDate } from '../lib/timetableCalendar';
import { buildTimetableImportCandidates, createPlanDraftFromTimetableImportCandidate } from '../lib/timetableImport';
import type { DayOccurrenceCancellationInput } from './dayOccurrenceCancellation';
import { createScheduleOccurrenceProjection } from './scheduleOccurrence';

export interface DayTimetableTimeChange { startTime: string; endTime: string }

// Persist one canonical override; never rewrite the recurring timetable master.
export function buildDayTimetableTimeEdit(input: DayOccurrenceCancellationInput, time: DayTimetableTimeChange) {
  const { occurrence, ownerId } = input;
  if (occurrence.ownerId !== ownerId || occurrence.source.backingKind !== 'timetable-template') {
    throw new Error('この予定を変更できません。');
  }
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(time.startTime) || !(clock.test(time.endTime) || time.endTime === '24:00')
    || minutesBetween(time.startTime, time.endTime) <= 0) {
    throw new Error('終了時刻は開始時刻より後にしてください。');
  }
  const date = occurrence.start.date;
  const current = createScheduleOccurrenceProjection({ ...input, startDate: date, endDate: date })
    .occurrences.find(row => row.id === occurrence.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(occurrence)) {
    throw new Error('予定が更新されました。現在の予定を開き直してください。');
  }
  const term = resolveTimetableTermForDate(date, input.timetableTerms, input.timetableTermId);
  const candidate = buildTimetableImportCandidates({
    templates: input.scheduleTemplates.filter(row => row.userId === ownerId), date,
    weekday: getRecurrenceWeekday(date), termId: term?.id ?? input.timetableTermId ?? 'default', term,
  }).find(row => row.sourceId === occurrence.source.backingId);
  if (!candidate) throw new Error('時間割が更新されました。現在の予定を開き直してください。');
  return {
    templates: candidate.templates,
    draft: { ...createPlanDraftFromTimetableImportCandidate(candidate, ownerId, date), ...time, endTime: time.endTime === '00:00' ? '24:00' : time.endTime },
  };
}
