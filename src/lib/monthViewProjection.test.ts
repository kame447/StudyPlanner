import { describe, expect, it, vi } from 'vitest';
import {
  buildMonthGrid,
  buildMonthPanelProjection,
  type MonthPanelProjection,
} from './monthViewProjection';
import type {
  Actual,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';

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

function createStandaloneActual(overrides: Partial<Actual> = {}): Actual {
  return {
    ...actual,
    id: 'standalone-1',
    planId: null,
    actualStartTime: '20:00',
    actualEndTime: '20:35',
    isAlignedToPlan: false,
    ...overrides,
  };
}

function expectCellMinutes(
  projection: MonthPanelProjection,
  expected: Record<string, [targetMinutes: number, actualMinutes: number]>,
) {
  expect(projection.cells).toHaveLength(42);
  expect(projection.cells.map((cell) => cell.date)).toEqual(
    expect.arrayContaining(Object.keys(expected)),
  );
  for (const cell of projection.cells) {
    expect([cell.targetMinutes, cell.actualMinutes], cell.date).toEqual(
      expected[cell.date] ?? [0, 0],
    );
  }
}

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

function createTimetableTerm(): TimetableTerm {
  return {
    id: 'term-1',
    userId: 'user-1',
    year: 2026,
    kind: 'custom',
    label: '前期',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function createScheduleTemplate(): ScheduleTemplate {
  return {
    id: 'class-1',
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    type: 'school-event',
    weekday: 'mon',
    startTime: '13:00',
    endTime: '14:30',
    termId: 'term-1',
    periodNumber: 3,
    classroom: '情報学部棟',
    memo: '',
    active: true,
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
    expect(grid.cells[grid.cells.length - 1]?.date).toBe('2026-10-11');
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

  it.each(['user-1', undefined])(
    'counts standalone actuals in a month with no plans (userId: %s)',
    (userId) => {
      const projection = buildMonthPanelProjection({
        monthDate: '2026-08-01',
        userId,
        plans: [],
        actuals: [
          createStandaloneActual(),
          createStandaloneActual({
            id: 'standalone-2',
            actualStartTime: '21:00',
            actualEndTime: '21:25',
          }),
          createStandaloneActual({
            id: 'standalone-next-day',
            occurrenceDate: '2026-08-15',
            actualStartTime: '08:00',
            actualEndTime: '08:20',
          }),
        ],
        monthEvents: [],
      });

      expectCellMinutes(projection, {
        '2026-08-14': [0, 60],
        '2026-08-15': [0, 20],
      });
      expect(projection.cells.every((cell) => cell.monthEvents.length === 0)).toBe(true);
    },
  );

  it('adds linked and standalone actual minutes on the same day without changing the target', () => {
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      userId: 'user-1',
      plans: [plan],
      actuals: [actual, createStandaloneActual()],
      monthEvents: [],
    });

    expectCellMinutes(projection, { '2026-08-14': [90, 95] });
  });

  it('includes actuals at both edges of the 42-cell grid and excludes dates outside it', () => {
    const projection = buildMonthPanelProjection({
      monthDate: '2026-09-01',
      userId: 'user-1',
      plans: [
        { ...plan, date: '2026-08-31' },
        {
          ...plan,
          id: 'trailing-plan',
          seriesId: 'trailing-plan',
          date: '2026-10-11',
          endTime: '09:45',
        },
      ],
      actuals: [
        { ...actual, occurrenceDate: '2026-08-31' },
        createStandaloneActual({ occurrenceDate: '2026-08-31' }),
        {
          ...actual,
          id: 'trailing-linked',
          planId: 'trailing-plan',
          occurrenceDate: '2026-10-11',
          actualEndTime: '09:30',
        },
        createStandaloneActual({
          id: 'trailing-standalone',
          occurrenceDate: '2026-10-11',
          actualEndTime: '20:50',
        }),
        createStandaloneActual({
          id: 'before-grid',
          occurrenceDate: '2026-08-30',
        }),
        createStandaloneActual({
          id: 'after-grid',
          occurrenceDate: '2026-10-12',
        }),
      ],
      monthEvents: [],
    });

    expect(projection.cells[0]).toMatchObject({
      date: '2026-08-31',
      inCurrentMonth: false,
    });
    expect(projection.cells[41]).toMatchObject({
      date: '2026-10-11',
      inCurrentMonth: false,
    });
    expectCellMinutes(projection, {
      '2026-08-31': [90, 95],
      '2026-10-11': [45, 70],
    });
    expect(projection.cells.some((cell) => cell.date === '2026-08-30')).toBe(false);
    expect(projection.cells.some((cell) => cell.date === '2026-10-12')).toBe(false);
  });

  it('returns zero minutes and no events in every cell of an empty month', () => {
    const projection = buildMonthPanelProjection({
      monthDate: '2026-09-01',
      plans: [],
      actuals: [],
      monthEvents: [],
    });

    expectCellMinutes(projection, {});
    expect(projection.cells.every((cell) => cell.monthEvents.length === 0)).toBe(true);
  });

  it('keeps explicit calendar dates at local midnight under a fixed clock', () => {
    // Use a local date constructor so the fixture also works in UTC and DST zones.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 1, 0, 5));
      const input = {
        monthDate: '2026-09-01',
        userId: 'user-1',
        plans: [{ ...plan, date: '2026-09-01', startTime: '00:00', endTime: '00:45' }],
        actuals: [
          createStandaloneActual({
            occurrenceDate: '2026-08-31',
            actualStartTime: '23:40',
            actualEndTime: '24:00',
          }),
          {
            ...actual,
            occurrenceDate: '2026-09-01',
            actualStartTime: '00:00',
            actualEndTime: '00:15',
          },
        ],
        monthEvents: [],
      };
      const projection = buildMonthPanelProjection(input);

      expect(projection.cells[0]?.date).toBe('2026-08-31');
      expect(projection.cells[41]?.date).toBe('2026-10-11');
      expectCellMinutes(projection, {
        '2026-08-31': [0, 20],
        '2026-09-01': [45, 15],
      });

      vi.setSystemTime(new Date(2027, 0, 1, 0, 5));
      expect(buildMonthPanelProjection(input)).toEqual(projection);
    } finally {
      vi.useRealTimers();
    }
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

  it('projects timetable templates as read-only calendar events without counting them as study targets', () => {
    const term = createTimetableTerm();
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      userId: 'user-1',
      plans: [],
      actuals: [],
      monthEvents: [],
      scheduleTemplates: [createScheduleTemplate()],
      timetableTermId: term.id,
      timetableTerm: term,
      timetableTerms: [term],
    });
    const mondayCell = projection.cells.find((cell) => cell.date === '2026-08-17');

    expect(mondayCell?.targetMinutes).toBe(0);
    expect(mondayCell?.monthEvents).toMatchObject([
      {
        id: 'timetable:class-1:2026-08-17',
        title: '情報学演習',
        startTime: '13:00',
        endTime: '14:30',
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

  it.each([
    {
      label: 'single all-day',
      startTime: '00:00',
      endDate: '2026-08-14',
      endTime: '24:00',
      dates: ['2026-08-14'],
    },
    {
      label: 'multi-day all-day',
      startTime: '00:00',
      endDate: '2026-08-16',
      endTime: '00:00',
      dates: ['2026-08-14', '2026-08-15'],
    },
    {
      label: 'multi-day timed',
      startTime: '18:00',
      endDate: '2026-08-16',
      endTime: '00:00',
      dates: ['2026-08-14', '2026-08-15'],
    },
  ])(
    'excludes the midnight end day of a $label event',
    ({ startTime, endDate, endTime, dates }) => {
      const projection = buildMonthPanelProjection({
        monthDate: '2026-08-01',
        userId: 'user-1',
        plans: [plan],
        actuals: [actual, createStandaloneActual()],
        monthEvents: [{ ...createMonthEvent('midnight-event', startTime), endDate, endTime }],
      });
      const event = {
        id: 'month-event:midnight-event:2026-08-14',
        date: '2026-08-14',
        endDate: dates[dates.length - 1],
        startTime,
        endTime: '24:00',
      };

      expect(
        projection.cells
          .filter((cell) => cell.monthEvents.length > 0)
          .map((cell) => cell.date),
      ).toEqual(dates);
      for (const date of dates) {
        expect(
          projection.cells.find((cell) => cell.date === date)?.monthEvents,
        ).toMatchObject([event]);
      }
      expectCellMinutes(projection, { '2026-08-14': [90, 95] });
    },
  );
});
