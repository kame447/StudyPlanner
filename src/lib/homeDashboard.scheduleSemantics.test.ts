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
