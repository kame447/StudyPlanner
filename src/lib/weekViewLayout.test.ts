import { describe, expect, it } from 'vitest';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import {
  buildLanes,
  scheduleOccurrenceCoversDate,
  scheduleOccurrenceTimesForDate,
} from './weekViewLayout';

function block(id: string, startTime: string, endTime: string) {
  return { id, title: id, subject: '数学', type: 'study' as const, startTime, endTime };
}

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

describe('week view lane allocation', () => {
  it('keeps empty input empty', () => {
    expect(buildLanes([])).toEqual([]);
  });

  it('sorts touching intervals without splitting their width', () => {
    const early = block('early', '08:00', '09:00');
    const late = block('late', '09:00', '10:00');
    expect(buildLanes([late, early])).toEqual([
      { ...early, lane: 0, laneCount: 1 },
      { ...late, lane: 0, laneCount: 1 },
    ]);
  });

  it('finalizes lane counts per connected overlap cluster and reuses the lowest free lane', () => {
    const a = block('a', '08:00', '10:00');
    const b = block('b', '09:00', '11:00');
    const c = block('c', '10:00', '12:00');
    const d = block('d', '12:00', '13:00');
    const e = block('e', '14:00', '15:00');
    const f = block('f', '14:30', '15:30');
    expect(buildLanes([f, d, c, b, e, a])).toEqual([
      { ...a, lane: 0, laneCount: 2 },
      { ...b, lane: 1, laneCount: 2 },
      { ...c, lane: 0, laneCount: 2 },
      { ...d, lane: 0, laneCount: 1 },
      { ...e, lane: 0, laneCount: 2 },
      { ...f, lane: 1, laneCount: 2 },
    ]);
  });

  it('keeps the peak cluster width for nested intervals after inner intervals end', () => {
    const outer = block('outer', '08:00', '14:00');
    const inner = block('inner', '09:00', '12:00');
    const nested = block('nested', '10:00', '11:00');
    const tail = block('tail', '12:00', '13:00');
    expect(buildLanes([tail, nested, inner, outer])).toEqual([
      { ...outer, lane: 0, laneCount: 3 },
      { ...inner, lane: 1, laneCount: 3 },
      { ...nested, lane: 2, laneCount: 3 },
      { ...tail, lane: 1, laneCount: 3 },
    ]);
  });

  it('sorts equal starts by end time and preserves input order for identical intervals', () => {
    const long = block('long', '08:00', '11:00');
    const first = block('first', '08:00', '09:00');
    const second = block('second', '08:00', '09:00');
    expect(buildLanes([long, first, second])).toEqual([
      { ...first, lane: 0, laneCount: 3 },
      { ...second, lane: 1, laneCount: 3 },
      { ...long, lane: 2, laneCount: 3 },
    ]);
  });

  it.each(['00:00', '24:00'])('treats end %s as the end of the day', (endTime) => {
    const late = block('late', '23:00', endTime);
    const overlap = block('overlap', '23:30', '24:00');
    expect(buildLanes([overlap, late])).toEqual([
      { ...late, lane: 0, laneCount: 2 },
      { ...overlap, lane: 1, laneCount: 2 },
    ]);
  });

  it.each(['09:00', '08:00'])('preserves the one-minute minimum for a 09:00–%s block', (endTime) => {
    const minimum = block('minimum', '09:00', endTime);
    const sameStart = block('same-start', '09:00', '09:01');
    const next = block('next', '09:01', '10:00');
    expect(buildLanes([next, sameStart, minimum])).toEqual([
      { ...minimum, lane: 0, laneCount: 2 },
      { ...sameStart, lane: 1, laneCount: 2 },
      { ...next, lane: 0, laneCount: 1 },
    ]);
  });

  it('preserves payload references and property order without mutating the input', () => {
    const payload = { id: 'plan-1' };
    const late = Object.freeze({ ...block('late', '10:00', '11:00'), payload });
    const early = Object.freeze(block('early', '08:00', '09:00'));
    const items: Array<ReturnType<typeof block> & { payload?: typeof payload }> = [late, early];
    Object.freeze(items);
    const result = buildLanes(items);
    expect(JSON.stringify(result)).toBe(JSON.stringify([
      { ...early, lane: 0, laneCount: 1 },
      { ...late, lane: 0, laneCount: 1 },
    ]));
    expect(result[1].payload).toBe(payload);
    expect(result[1]).not.toBe(late);
    expect(items).toEqual([late, early]);
  });
});

describe('week view local-date occurrence clipping', () => {
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
