import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMonthGrid } from './date';
import {
  buildMonthlyStudySeriesInRange,
  buildWeeklyStudySeries,
  calculateWeeklyStudyMinutes,
} from './studyAnalytics';
import type { Actual } from '../types/domain';

const timezones = ['America/Los_Angeles', 'Asia/Tokyo', 'UTC'];
const timezoneCases = [
  {
    name: 'DST start',
    selectedDate: '2026-03-08',
    weekDates: [
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-07', '2026-03-08',
    ],
    nextMonday: '2026-03-09',
    monthStart: '2026-03-01',
    monthEnd: '2026-03-31',
    gridStart: '2026-02-23',
    gridEnd: '2026-04-05',
    daysInMonth: 31,
  },
  {
    name: 'DST end',
    selectedDate: '2026-11-01',
    weekDates: [
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
      '2026-10-30', '2026-10-31', '2026-11-01',
    ],
    nextMonday: '2026-11-02',
    monthStart: '2026-11-01',
    monthEnd: '2026-11-30',
    gridStart: '2026-10-26',
    gridEnd: '2026-12-06',
    daysInMonth: 30,
  },
];

function actual(date: string): Actual {
  return {
    id: `actual-${date}`,
    userId: 'user-1',
    planId: null,
    occurrenceDate: date,
    actualStartTime: '09:00',
    actualEndTime: '09:30',
    title: '数学演習',
    subject: '数学',
    isAlignedToPlan: false,
    note: '',
    updatedAt: '2026-11-02T00:00:00.000Z',
  };
}

describe.each(timezones)('study analytics in %s', (timezone) => {
  let originalTimezone: string | undefined;

  beforeEach(() => {
    originalTimezone = process.env.TZ;
    process.env.TZ = timezone;
  });

  afterEach(() => {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  it('runs with the requested timezone, including its DST offsets', () => {
    const expectedOffsets = timezone === 'America/Los_Angeles'
      ? [480, 420, 420, 480]
      : Array(4).fill(timezone === 'Asia/Tokyo' ? -540 : 0);

    expect([
      '2026-03-07', '2026-03-09', '2026-10-31', '2026-11-02',
    ].map((date) => new Date(`${date}T00:00:00`).getTimezoneOffset()))
      .toEqual(expectedOffsets);
  });

  describe.each(timezoneCases)('$name', (period) => {
    it('keeps all seven daily totals and excludes the following Monday', () => {
      const actuals = [...period.weekDates, period.nextMonday].map(actual);

      expect(buildWeeklyStudySeries(period.selectedDate, [], actuals)).toEqual(
        period.weekDates.map((date) => ({ date, minutes: 30 })),
      );
      expect(calculateWeeklyStudyMinutes(period.selectedDate, [], actuals)).toBe(210);
      expect(buildWeeklyStudySeries(period.nextMonday, [], actuals)[0]).toEqual({
        date: period.nextMonday,
        minutes: 30,
      });
    });

    it('preserves month boundaries and totals on both sides of the transition', () => {
      const actuals = [period.monthStart, period.nextMonday, period.monthEnd].map(actual);

      expect(buildMonthlyStudySeriesInRange(
        period.selectedDate, period.selectedDate, [], actuals,
      )).toEqual([{
        startDate: period.monthStart,
        endDate: period.monthEnd,
        minutes: 90,
      }]);
    });

    it('keeps 42 distinct consecutive calendar cells in the month grid', () => {
      const grid = getMonthGrid(period.selectedDate);

      expect(grid).toHaveLength(42);
      expect(new Set(grid.map((cell) => cell.date)).size).toBe(42);
      expect(grid[0].date).toBe(period.gridStart);
      expect(grid[41].date).toBe(period.gridEnd);
      expect(grid.filter((cell) => cell.inCurrentMonth)).toHaveLength(period.daysInMonth);
      // UTC arithmetic here is an independent oracle for Y-M-D labels only.
      const firstDay = Date.parse(`${period.gridStart}T00:00:00Z`);
      expect(grid.map((cell) => cell.date)).toEqual(
        Array.from({ length: 42 }, (_, index) =>
          new Date(firstDay + index * 86_400_000).toISOString().slice(0, 10)),
      );
    });
  });
});
