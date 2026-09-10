import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { sortMonthEvents } from './monthEvents';
import type { MonthEvent } from '../types/domain';

export function projectReadOnlyTimetableOccurrencesForDay(
  occurrences: readonly ScheduleOccurrence[],
  date: string,
): MonthEvent[] {
  return sortMonthEvents(
    occurrences
      .filter(
        (occurrence) => occurrence.source.backingKind === 'timetable-template',
      )
      .map((occurrence) => ({
        id: occurrence.id,
        userId: occurrence.ownerId,
        date,
        endDate: date,
        title: occurrence.title,
        startTime: occurrence.start.date === date ? occurrence.start.time : '00:00',
        endTime: occurrence.end.date === date ? occurrence.end.time : '24:00',
        repeat: 'none' as const,
        repeatUntil: null,
        excludedDates: [],
        url: '',
        memo: '',
        checklist: [],
        locationTags: [],
        createdAt: '',
        updatedAt: '',
      })),
  );
}
