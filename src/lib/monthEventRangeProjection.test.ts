import { describe, expect, it } from 'vitest';
import { buildMonthPanelProjection } from './monthViewProjection';
import type { MonthEvent } from '../types/domain';

function createMultiDayEvent(): MonthEvent {
  return {
    id: 'range-event',
    userId: 'user-1',
    date: '2026-08-10',
    endDate: '2026-08-12',
    title: '複数日イベント',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('month event range projection', () => {
  it('projects a multi-day event into every covered month cell only', () => {
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      plans: [],
      actuals: [],
      monthEvents: [createMultiDayEvent()],
    });

    for (const date of ['2026-08-10', '2026-08-11', '2026-08-12']) {
      expect(
        projection.cells.find((cell) => cell.date === date)?.monthEvents.map((event) => event.id),
      ).toContain('range-event');
    }

    expect(
      projection.cells.find((cell) => cell.date === '2026-08-09')?.monthEvents.map((event) => event.id),
    ).not.toContain('range-event');
    expect(
      projection.cells.find((cell) => cell.date === '2026-08-13')?.monthEvents.map((event) => event.id),
    ).not.toContain('range-event');
  });
});
