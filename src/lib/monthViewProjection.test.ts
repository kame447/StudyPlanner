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
  it('builds a stable six-week calendar grid even when the month fits in five weeks', () => {
    const grid = buildMonthGrid('2026-09-01');

    expect(grid.weeks).toHaveLength(6);
    expect(grid.cells).toHaveLength(42);
    expect(grid.cells[0]?.date).toBe('2026-08-31');
    expect(grid.cells.at(-1)?.date).toBe('2026-10-11');
    expect(grid.cells.find((cell) => cell.date === '2026-09-01')).toEqual({
      date: '2026-09-01',
      inCurrentMonth: true,
    });
    expect(grid.cells.some((cell) => !cell.inCurrentMonth)).toBe(true);
  });

  it('projects planned minutes, normalized study records, and sorted schedule occurrences per day', () => {
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      userId: 'user-1',
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
    expect(targetCell?.monthEvents.map((event) => event.id)).toEqual([
      'month-event:early:2026-08-14',
      'month-event:late:2026-08-14',
    ]);
  });

  it('shows non-study Plan occurrences as calendar events without turning study plans into event pills', () => {
    const appointment: Plan = {
      ...plan,
      id: 'appointment-1',
      seriesId: 'appointment-1',
      title: '美容院',
      subject: '予定',
      startTime: '18:00',
      endTime: '19:00',
      type: 'other',
    };
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      userId: 'user-1',
      plans: [plan, appointment],
      actuals: [],
      monthEvents: [],
    });
    const targetCell = projection.cells.find((cell) => cell.date === '2026-08-14');

    expect(targetCell?.targetMinutes).toBe(90);
    expect(targetCell?.monthEvents).toMatchObject([
      {
        id: 'plan:appointment-1:2026-08-14',
        title: '美容院',
        startTime: '18:00',
        endTime: '19:00',
      },
    ]);
  });

  it('uses the same multi-day occurrence semantics for month event lanes', () => {
    const trip: MonthEvent = {
      ...createMonthEvent('trip', '18:00'),
      date: '2026-08-14',
      endDate: '2026-08-16',
      endTime: '10:00',
    };
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      userId: 'user-1',
      plans: [],
      actuals: [],
      monthEvents: [trip],
    });

    const visibleDates = projection.cells
      .filter((cell) => cell.monthEvents.some((event) => event.title === 'trip'))
      .map((cell) => cell.date);

    expect(visibleDates).toEqual(['2026-08-14', '2026-08-15', '2026-08-16']);
    const occurrence = projection.cells
      .find((cell) => cell.date === '2026-08-14')
      ?.monthEvents[0];
    expect(occurrence).toMatchObject({
      id: 'month-event:trip:2026-08-14',
      date: '2026-08-14',
      endDate: '2026-08-16',
      startTime: '18:00',
      endTime: '10:00',
    });
  });
});
