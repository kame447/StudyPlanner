import { describe, expect, it } from 'vitest';
import { createScheduleOccurrenceProjection, scheduleOccurrenceCoversDate, scheduleOccurrenceTimesForDate, type ScheduleOccurrence } from './scheduleOccurrence';

function occurrence(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
): ScheduleOccurrence {
  return {
    id: 'event-1',
    ownerId: 'user-1',
    title: '予定',
    subject: '',
    category: 'other',
    busy: true,
    start: { date: startDate, time: startTime },
    end: { date: endDate, time: endTime },
    source: { kind: 'month-event', id: 'event-1', backingKind: 'month-event', backingId: 'event-1' },
  };
}

describe('occurrence local-date boundary', () => {
  it('preserves same-day times and excludes adjacent dates', () => {
    const event = occurrence('2026-08-24', '08:15', '2026-08-24', '09:45');
    expect(scheduleOccurrenceCoversDate(event, '2026-08-23')).toBe(false);
    expect(scheduleOccurrenceCoversDate(event, '2026-08-24')).toBe(true);
    expect(scheduleOccurrenceCoversDate(event, '2026-08-25')).toBe(false);
    expect(scheduleOccurrenceTimesForDate(event, '2026-08-24')).toEqual({
      startTime: '08:15', endTime: '09:45',
    });
  });

  it.each([
    ['2026-08-31', '2026-09-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-29', '2028-03-01'],
    ['2026-03-08', '2026-03-09'],
    ['2026-11-01', '2026-11-02'],
  ])('clips overnight times across the local calendar boundary %s → %s', (start, end) => {
    const event = occurrence(start, '23:30', end, '01:15');
    expect(scheduleOccurrenceCoversDate(event, start)).toBe(true);
    expect(scheduleOccurrenceCoversDate(event, end)).toBe(true);
    expect(scheduleOccurrenceTimesForDate(event, start)).toEqual({
      startTime: '23:30', endTime: '24:00',
    });
    expect(scheduleOccurrenceTimesForDate(event, end)).toEqual({
      startTime: '00:00', endTime: '01:15',
    });
  });

  it('clips an interior date to a whole day without changing the occurrence', () => {
    const event = occurrence('2026-08-24', '18:00', '2026-08-26', '10:00');
    const before = JSON.stringify(event);
    expect(scheduleOccurrenceCoversDate(event, '2026-08-25')).toBe(true);
    expect(scheduleOccurrenceTimesForDate(event, '2026-08-25')).toEqual({
      startTime: '00:00', endTime: '24:00',
    });
    expect(JSON.stringify(event)).toBe(before);
  });

  it('excludes the end date when an occurrence ends exactly at midnight', () => {
    const event = occurrence('2026-08-31', '23:00', '2026-09-01', '00:00');
    expect(scheduleOccurrenceCoversDate(event, '2026-08-31')).toBe(true);
    expect(scheduleOccurrenceCoversDate(event, '2026-09-01')).toBe(false);
    expect(scheduleOccurrenceTimesForDate(event, '2026-08-31')).toEqual({
      startTime: '23:00', endTime: '24:00',
    });
  });

  it('covers only the intended local day for an all-day occurrence', () => {
    const event = occurrence('2026-08-31', '00:00', '2026-09-01', '00:00');
    expect(scheduleOccurrenceCoversDate(event, '2026-08-30')).toBe(false);
    expect(scheduleOccurrenceCoversDate(event, '2026-08-31')).toBe(true);
    expect(scheduleOccurrenceCoversDate(event, '2026-09-01')).toBe(false);
    expect(scheduleOccurrenceTimesForDate(event, '2026-08-31')).toEqual({
      startTime: '00:00', endTime: '24:00',
    });
  });
});

describe('projected recurring event day admission', () => {
  it.each([
    ['00:00', ['2026-01-31']],
    ['24:00', ['2026-01-31', '2026-02-01']],
  ])('keeps an explicit later %s endpoint and occurrence identity', (endTime, coveredDates) => {
    const event = {
      id: 'series', userId: 'user-1', title: 'Trip', date: '2026-01-24',
      endDate: '2026-01-25', startTime: '23:00', endTime,
      repeat: 'weekly' as const, repeatUntil: '2026-01-31', excludedDates: [],
      url: '', memo: '', checklist: [], locationTags: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const before = structuredClone(event);
    const { occurrences } = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-30', endDate: '2026-02-02',
      plans: [], monthEvents: [event],
    });
    expect(occurrences).toHaveLength(1);
    const current = occurrences[0];
    const snapshot = structuredClone(current);
    const days = ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'];
    expect(days.filter(day => scheduleOccurrenceCoversDate(current, day))).toEqual(coveredDates);
    expect(scheduleOccurrenceTimesForDate(current, '2026-01-31')).toEqual({ startTime: '23:00', endTime: '24:00' });
    if (coveredDates.includes('2026-02-01')) {
      expect(scheduleOccurrenceTimesForDate(current, '2026-02-01')).toEqual({ startTime: '00:00', endTime: '24:00' });
    }
    expect(current.id).toBe('month-event:series:2026-01-31');
    expect(current).toEqual(snapshot);
    expect(event).toEqual(before);
    expect(createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-30', endDate: '2026-02-02',
      plans: [], monthEvents: [{ ...event, excludedDates: ['2026-01-31'] }],
    }).occurrences).toEqual([]);
  });
});
