import { describe, expect, it } from 'vitest';
import { buildMonthGrid, buildMonthPanelProjection } from './monthViewProjection';
import type { Actual, MonthEvent, Plan } from '../types/domain';

const plan: Plan = {
  id: 'plan-1',
  seriesId: 'plan-1',
  userId: 'user-1',
  title: '数学',
  subject: '数学',
  date: '2026-08-14',
  startTime: '09:00',
  endTime: '10:30',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [],
  type: 'study',
  memo: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const actual: Actual = {
  id: 'actual-1',
  userId: 'user-1',
  planId: 'plan-1',
  occurrenceDate: '2026-08-14',
  actualStartTime: '09:10',
  actualEndTime: '10:10',
  subject: '数学',
  isAlignedToPlan: true,
  note: '',
  updatedAt: '2026-08-14T10:10:00.000Z',
};

function createMonthEvent(id: string, startTime: string): MonthEvent {
  return {
    id,
    userId: 'user-1',
    date: '2026-08-14',
    title: id,
    startTime,
    endTime: '18:00',
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

describe('month view projection', () => {
  it('builds the month grid with adjacent dates marked outside the active month', () => {
    const grid = buildMonthGrid('2026-08-01');

    expect(grid.cells).toHaveLength(grid.weeks.length * 7);
    expect(grid.cells.find((cell) => cell.date === '2026-08-01')).toEqual({
      date: '2026-08-01',
      inCurrentMonth: true,
    });
    expect(grid.cells.some((cell) => !cell.inCurrentMonth)).toBe(true);
  });

  it('projects planned minutes, normalized study records, and sorted month events per day', () => {
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      plans: [plan],
      actuals: [actual],
      monthEvents: [
        createMonthEvent('late', '17:00'),
        createMonthEvent('early', '08:00'),
      ],
    });
    const targetCell = projection.cells.find((cell) => cell.date === '2026-08-14');

    expect(targetCell).toMatchObject({
      targetMinutes: 90,
      actualMinutes: 60,
    });
    expect(targetCell?.monthEvents.map((event) => event.id)).toEqual(['early', 'late']);
  });
});
