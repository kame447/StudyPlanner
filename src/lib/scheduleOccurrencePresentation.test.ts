import { describe, expect, it } from 'vitest';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import {
  isScheduleOccurrenceOutsideHourlyGrid,
  layoutWeekSpanningOccurrences,
} from './scheduleOccurrencePresentation';

const WEEK_DATES = [
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
  '2026-08-30',
];

function occurrence(
  id: string,
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
): ScheduleOccurrence {
  return {
    id,
    ownerId: 'user-1',
    title: id,
    subject: '予定',
    category: 'other',
    busy: true,
    start: { date: startDate, time: startTime },
    end: { date: endDate, time: endTime },
    source: {
      kind: 'month-event',
      id,
      backingKind: 'month-event',
      backingId: id,
    },
    planSourceType: 'manual',
  };
}

describe('schedule occurrence presentation', () => {
  it('keeps same-day timed occurrences in the hourly grid', () => {
    expect(
      isScheduleOccurrenceOutsideHourlyGrid(
        occurrence('timed', '2026-08-25', '09:00', '2026-08-25', '10:00'),
      ),
    ).toBe(false);
  });

  it('classifies normalized all-day and cross-midnight occurrences as spanning', () => {
    expect(
      isScheduleOccurrenceOutsideHourlyGrid(
        occurrence('all-day', '2026-08-25', '00:00', '2026-08-26', '00:00'),
      ),
    ).toBe(true);
    expect(
      isScheduleOccurrenceOutsideHourlyGrid(
        occurrence('cross-midnight', '2026-08-25', '23:00', '2026-08-26', '01:00'),
      ),
    ).toBe(true);
  });

  it('treats midnight end as an exclusive boundary for a one-day all-day event', () => {
    const layout = layoutWeekSpanningOccurrences(
      [occurrence('all-day', '2026-08-25', '00:00', '2026-08-26', '00:00')],
      WEEK_DATES,
    );

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({ startColumn: 1, endColumn: 2, lane: 0 });
  });

  it('spans every calendar day touched by an event that ends during the final day', () => {
    const layout = layoutWeekSpanningOccurrences(
      [occurrence('trip', '2026-08-27', '12:00', '2026-08-29', '10:00')],
      WEEK_DATES,
    );

    expect(layout.items[0]).toMatchObject({ startColumn: 3, endColumn: 6, lane: 0 });
  });

  it('clips spanning events to the visible week', () => {
    const layout = layoutWeekSpanningOccurrences(
      [occurrence('long-trip', '2026-08-20', '10:00', '2026-09-02', '18:00')],
      WEEK_DATES,
    );

    expect(layout.items[0]).toMatchObject({ startColumn: 0, endColumn: 7, lane: 0 });
  });

  it('allocates another lane only when date spans overlap', () => {
    const layout = layoutWeekSpanningOccurrences(
      [
        occurrence('a', '2026-08-25', '00:00', '2026-08-28', '00:00'),
        occurrence('b', '2026-08-26', '12:00', '2026-08-27', '13:00'),
        occurrence('c', '2026-08-28', '00:00', '2026-08-29', '00:00'),
      ],
      WEEK_DATES,
    );

    expect(layout.laneCount).toBe(2);
    expect(layout.items.find((item) => item.occurrence.id === 'a')?.lane).toBe(0);
    expect(layout.items.find((item) => item.occurrence.id === 'b')?.lane).toBe(1);
    expect(layout.items.find((item) => item.occurrence.id === 'c')?.lane).toBe(0);
  });
});
