import { describe, expect, it } from 'vitest';
import type { Actual, Plan } from '../types/domain';
import { buildHomeDashboardModel } from './homeDashboard';

const TIMESTAMP = '2026-09-05T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '英単語',
    subject: '英語',
    date: '2026-09-05',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: 'plan-1',
    occurrenceDate: '2026-09-05',
    actualStartTime: '09:00',
    actualEndTime: '10:00',
    subject: '英語',
    note: '',
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

describe('home dashboard schedule semantics', () => {
  it('shows non-study plans as schedule items without counting them as study progress or missing actuals', () => {
    const studyPlan = plan();
    const schoolEvent = plan({
      id: 'school-event',
      seriesId: 'school-event',
      title: '大学の授業',
      subject: '情報学',
      startTime: '08:00',
      endTime: '09:00',
      type: 'school-event',
    });
    const schoolActual = actual({
      id: 'school-actual',
      planId: schoolEvent.id,
      actualStartTime: '08:00',
      actualEndTime: '09:00',
      subject: '情報学',
    });

    const dashboard = buildHomeDashboardModel({
      plans: [schoolEvent, studyPlan],
      actuals: [schoolActual],
      todos: [],
      now: new Date('2026-09-05T12:00:00'),
    });

    expect(dashboard.todayPlans.map((item) => item.id)).toEqual([
      'school-event',
      'plan-1',
    ]);
    expect(dashboard.missingActualPlans.map((item) => item.id)).toEqual(['plan-1']);
    expect(dashboard.weekPlannedMinutes).toBe(60);
    expect(dashboard.weekActualMinutes).toBe(0);
    expect(dashboard.currentStreak).toBe(0);
  });

  it('continues to count standalone study actuals', () => {
    const standalone = actual({
      id: 'standalone',
      planId: null,
      actualStartTime: '11:00',
      actualEndTime: '11:30',
      subject: '数学',
    });

    const dashboard = buildHomeDashboardModel({
      plans: [],
      actuals: [standalone],
      todos: [],
      now: new Date('2026-09-05T12:00:00'),
    });

    expect(dashboard.weekPlannedMinutes).toBe(0);
    expect(dashboard.weekActualMinutes).toBe(30);
    expect(dashboard.currentStreak).toBe(1);
  });
});

describe('Home progress inclusion preferences', () => {
  const preferences = { includeGeneralEvents: false, includeTimetable: false };
  const study = plan();
  const general = plan({ id: 'exam', type: 'mock-exam', title: '試験' });
  // Imported classes may retain type=study. Provenance must take precedence.
  const timetable = plan({ id: 'class', sourceType: 'timetable', sourceId: 'template', type: 'study' });
  const plans = [study, general, timetable];
  const actuals = plans.map((item) => actual({ id: `${item.id}-actual`, planId: item.id, actualEndTime: '09:30' }));
  const now = new Date('2026-09-05T12:00:00');

  it.each([
    [false, false, 60, 30],
    [true, false, 120, 60],
    [false, true, 120, 60],
    [true, true, 180, 90],
  ])('uses one membership for planned and actual minutes (%s, %s)', (includeGeneralEvents, includeTimetable, planned, recorded) => {
    const snapshot = JSON.stringify({ plans, actuals });
    const dashboard = buildHomeDashboardModel({ plans, actuals, todos: [], now,
      progressPreferences: { includeGeneralEvents, includeTimetable } });
    expect(dashboard.weekPlannedMinutes).toBe(planned);
    expect(dashboard.weekExpectedMinutesByNow).toBe(planned);
    expect(dashboard.weekActualMinutes).toBe(recorded);
    expect(dashboard.weekActualMinutesByNow).toBe(recorded);
    expect(dashboard.weekProgressPercent).toBe(50);
    expect(dashboard.weekDeltaMinutesByNow).toBe(recorded - planned);
    expect(dashboard.missingActualPlans).toHaveLength(0);
    expect(dashboard.todayPlans).toHaveLength(3);
    expect(JSON.stringify({ plans, actuals })).toBe(snapshot);
  });

  it('does not mark registration or elapsed time complete; independently scopes missing records', () => {
    for (const [includeGeneralEvents, includeTimetable, expected] of [
      [false, false, ['plan-1']], [true, false, ['plan-1', 'exam']],
      [false, true, ['plan-1', 'class']], [true, true, ['plan-1', 'exam', 'class']],
    ] as const) {
      const dashboard = buildHomeDashboardModel({ plans, actuals: [], todos: [], now,
        progressPreferences: { includeGeneralEvents, includeTimetable } });
      expect(dashboard.weekActualMinutes).toBe(0);
      expect(dashboard.weekProgressPercent).toBe(0);
      expect(dashboard.missingActualPlans.map(item => item.id).sort()).toEqual([...expected].sort());
    }
  });

  it('retains normalized deduplication, standalone records and study actuals when toggled back off', () => {
    const dashboard = buildHomeDashboardModel({ plans, todos: [], now, progressPreferences: preferences,
      actuals: [...actuals, actual({ id: 'older', updatedAt: '2026-09-01T00:00:00Z' }),
        actual({ id: 'standalone', planId: null, actualEndTime: '09:15' })] });
    expect(dashboard.weekPlannedMinutes).toBe(60);
    expect(dashboard.weekActualMinutes).toBe(45);
  });
});
