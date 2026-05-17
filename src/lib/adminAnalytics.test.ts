import { describe, expect, it } from 'vitest';
import {
  buildAdminDashboardStats,
  buildMaterialSummaries,
  filterAdminUserSummaries,
  summarizeDayReport,
  summarizeLast7Days,
  summarizeMonthReport,
  summarizeWeekReport,
} from './adminAnalytics';
import type { Actual, AdminUserSummary, DayNote, Plan, TodoTask } from '../types/domain';

function makeActual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: overrides.id ?? 'actual-1',
    userId: overrides.userId ?? 'user-1',
    planId: overrides.planId ?? null,
    occurrenceDate: overrides.occurrenceDate ?? '2026-05-16',
    actualStartTime: overrides.actualStartTime ?? '09:00',
    actualEndTime: overrides.actualEndTime ?? '10:00',
    title: overrides.title ?? '英語',
    subject: overrides.subject ?? '英語',
    isAlignedToPlan: overrides.isAlignedToPlan ?? false,
    note: overrides.note ?? '',
    updatedAt: overrides.updatedAt ?? '2026-05-16T10:00:00.000Z',
    materialId: overrides.materialId,
    materialName: overrides.materialName,
  };
}

function makeTodo(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id: overrides.id ?? 'todo-1',
    userId: overrides.userId ?? 'user-1',
    title: overrides.title ?? '課題',
    subject: overrides.subject ?? '英語',
    type: overrides.type ?? 'study',
    estimatedMinutes: overrides.estimatedMinutes ?? null,
    dueDate: overrides.dueDate ?? null,
    dueTime: overrides.dueTime ?? null,
    memo: overrides.memo ?? '',
    status: overrides.status ?? 'open',
    scheduledPlanId: overrides.scheduledPlanId ?? null,
    pinned: overrides.pinned ?? false,
    createdAt: overrides.createdAt ?? '2026-05-10T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-15T12:00:00.000Z',
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: overrides.id ?? 'plan-1',
    seriesId: overrides.seriesId ?? 'plan-1',
    userId: overrides.userId ?? 'user-1',
    title: overrides.title ?? '数学',
    subject: overrides.subject ?? '数学',
    date: overrides.date ?? '2026-05-16',
    startTime: overrides.startTime ?? '10:00',
    endTime: overrides.endTime ?? '11:00',
    repeat: overrides.repeat ?? 'none',
    repeatUntil: overrides.repeatUntil ?? null,
    excludedDates: overrides.excludedDates ?? [],
    recurrenceRules: overrides.recurrenceRules ?? [],
    type: overrides.type ?? 'study',
    memo: overrides.memo ?? '',
    createdAt: overrides.createdAt ?? '2026-05-10T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-14T00:00:00.000Z',
    sourceType: overrides.sourceType,
    sourceId: overrides.sourceId,
    sourceDate: overrides.sourceDate,
    occurrenceDate: overrides.occurrenceDate,
    occurrenceKey: overrides.occurrenceKey,
    materialId: overrides.materialId,
    materialName: overrides.materialName,
  };
}

function makeDayNote(overrides: Partial<DayNote> = {}): DayNote {
  return {
    id: overrides.id ?? 'note-1',
    userId: overrides.userId ?? 'user-1',
    date: overrides.date ?? '2026-05-16',
    quickMemo: overrides.quickMemo ?? '',
    reflection: overrides.reflection ?? '',
    nextFocus: overrides.nextFocus ?? '',
    checkedPlan: overrides.checkedPlan ?? false,
    checkedRecord: overrides.checkedRecord ?? false,
    checkedReady: overrides.checkedReady ?? false,
    updatedAt: overrides.updatedAt ?? '2026-05-16T00:00:00.000Z',
  };
}

describe('adminAnalytics dashboard stats', () => {
  it('summarizes today, this week, incomplete todos, and latest update', () => {
    const stats = buildAdminDashboardStats({
      plans: [],
      actuals: [
        makeActual({
          id: 'today',
          occurrenceDate: '2026-05-16',
          actualStartTime: '09:00',
          actualEndTime: '10:00',
          updatedAt: '2026-05-16T10:00:00.000Z',
        }),
        makeActual({
          id: 'week',
          occurrenceDate: '2026-05-15',
          actualStartTime: '20:00',
          actualEndTime: '21:30',
          updatedAt: '2026-05-15T21:30:00.000Z',
        }),
      ],
      todos: [
        makeTodo({ id: 'open', status: 'open' }),
        makeTodo({ id: 'scheduled', status: 'scheduled' }),
        makeTodo({ id: 'done', status: 'done' }),
      ],
      dayNotes: [
        {
          id: 'note-1',
          userId: 'user-1',
          date: '2026-05-16',
          quickMemo: '',
          reflection: '',
          nextFocus: '',
          checkedPlan: false,
          checkedRecord: false,
          checkedReady: false,
          updatedAt: '2026-05-16T23:00:00.000Z',
        },
      ],
      referenceDate: '2026-05-16',
    });

    expect(stats.todayStudyMinutes).toBe(60);
    expect(stats.weekStudyMinutes).toBe(150);
    expect(stats.todayActualCount).toBe(1);
    expect(stats.incompleteTodoCount).toBe(2);
    expect(stats.lastUpdatedAt).toBe('2026-05-16T23:00:00.000Z');
  });

  it('returns safe empty values when records are empty', () => {
    expect(
      buildAdminDashboardStats({
        plans: [],
        actuals: [],
        todos: [],
        referenceDate: '2026-05-16',
      }),
    ).toEqual({
      todayStudyMinutes: 0,
      weekStudyMinutes: 0,
      todayActualCount: 0,
      incompleteTodoCount: 0,
      lastUpdatedAt: null,
    });
  });
});

describe('adminAnalytics period reports', () => {
  it('summarizes a day report without including outside records', () => {
    const report = summarizeDayReport({
      selectedDate: '2026-05-16',
      plans: [makePlan({ id: 'today-plan', date: '2026-05-16' })],
      actuals: [
        makeActual({
          id: 'inside',
          occurrenceDate: '2026-05-16',
          actualStartTime: '09:00',
          actualEndTime: '10:15',
        }),
        makeActual({
          id: 'outside',
          occurrenceDate: '2026-05-15',
          actualStartTime: '09:00',
          actualEndTime: '12:00',
        }),
      ],
      todos: [makeTodo({ status: 'open' })],
      dayNotes: [makeDayNote({ date: '2026-05-16', quickMemo: 'memo' })],
    });

    expect(report.startDate).toBe('2026-05-16');
    expect(report.endDate).toBe('2026-05-16');
    expect(report.actualMinutes).toBe(75);
    expect(report.actualCount).toBe(1);
    expect(report.actuals.map((actual) => actual.id)).toEqual(['inside']);
    expect(report.dayNotes).toHaveLength(1);
  });

  it('summarizes a week report by date', () => {
    const report = summarizeWeekReport({
      selectedDate: '2026-05-16',
      plans: [],
      actuals: [
        makeActual({
          id: 'monday',
          occurrenceDate: '2026-05-11',
          actualStartTime: '09:00',
          actualEndTime: '10:00',
        }),
        makeActual({
          id: 'saturday',
          occurrenceDate: '2026-05-16',
          actualStartTime: '11:00',
          actualEndTime: '12:30',
        }),
        makeActual({
          id: 'next-week',
          occurrenceDate: '2026-05-18',
          actualStartTime: '09:00',
          actualEndTime: '14:00',
        }),
      ],
      todos: [],
      dayNotes: [],
    });

    expect(report.startDate).toBe('2026-05-11');
    expect(report.endDate).toBe('2026-05-17');
    expect(report.actualMinutes).toBe(150);
    expect(report.dailySummaries.find((entry) => entry.date === '2026-05-11')).toMatchObject({
      minutes: 60,
      actualCount: 1,
    });
    expect(report.dailySummaries.find((entry) => entry.date === '2026-05-16')).toMatchObject({
      minutes: 90,
      actualCount: 1,
    });
    expect(report.actuals.map((actual) => actual.id)).not.toContain('next-week');
  });

  it('summarizes a month report by week', () => {
    const report = summarizeMonthReport({
      selectedDate: '2026-05-16',
      plans: [],
      actuals: [
        makeActual({
          id: 'first-week',
          occurrenceDate: '2026-05-01',
          actualStartTime: '09:00',
          actualEndTime: '10:00',
        }),
        makeActual({
          id: 'third-week',
          occurrenceDate: '2026-05-16',
          actualStartTime: '11:00',
          actualEndTime: '12:30',
        }),
        makeActual({
          id: 'outside-month',
          occurrenceDate: '2026-06-01',
          actualStartTime: '09:00',
          actualEndTime: '14:00',
        }),
      ],
      todos: [],
      dayNotes: [],
    });

    expect(report.startDate).toBe('2026-05-01');
    expect(report.endDate).toBe('2026-05-31');
    expect(report.actualMinutes).toBe(150);
    expect(report.weeklySummaries[0]).toMatchObject({
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      minutes: 60,
      actualCount: 1,
    });
    expect(
      report.weeklySummaries.find((entry) => entry.startDate === '2026-05-11'),
    ).toMatchObject({
      minutes: 90,
      actualCount: 1,
    });
    expect(report.actuals.map((actual) => actual.id)).not.toContain('outside-month');
  });

  it('returns empty period report values when records are empty', () => {
    const report = summarizeWeekReport({
      selectedDate: '2026-05-16',
      plans: [],
      actuals: [],
      todos: [],
      dayNotes: [],
    });

    expect(report.actualMinutes).toBe(0);
    expect(report.actualCount).toBe(0);
    expect(report.dailySummaries).toHaveLength(7);
    expect(report.dailySummaries.every((entry) => entry.minutes === 0)).toBe(true);
    expect(report.materialSummaries).toEqual([]);
  });
});

describe('adminAnalytics detail summaries', () => {
  it('builds seven daily record summaries ending at the reference date', () => {
    const summaries = summarizeLast7Days(
      [],
      [
        makeActual({
          id: 'yesterday',
          occurrenceDate: '2026-05-15',
          actualStartTime: '20:00',
          actualEndTime: '21:30',
        }),
        makeActual({
          id: 'today',
          occurrenceDate: '2026-05-16',
          actualStartTime: '09:00',
          actualEndTime: '10:00',
        }),
      ],
      '2026-05-16',
    );

    expect(summaries).toHaveLength(7);
    expect(summaries[0].date).toBe('2026-05-10');
    expect(summaries[5]).toMatchObject({
      date: '2026-05-15',
      minutes: 90,
      actualCount: 1,
    });
    expect(summaries[6]).toMatchObject({
      date: '2026-05-16',
      minutes: 60,
      actualCount: 1,
    });
  });

  it('groups material summaries by material, then title fallback', () => {
    const summaries = buildMaterialSummaries(
      [makePlan({ id: 'plan-1', title: '数学演習' })],
      [
        makeActual({
          id: 'material-a',
          materialName: 'abceed',
          actualStartTime: '09:00',
          actualEndTime: '10:00',
        }),
        makeActual({
          id: 'material-b',
          materialName: 'abceed',
          actualStartTime: '10:00',
          actualEndTime: '10:30',
        }),
        makeActual({
          id: 'title-fallback',
          title: '数学演習',
          actualStartTime: '11:00',
          actualEndTime: '11:20',
        }),
      ],
    );

    expect(summaries[0]).toMatchObject({
      label: 'abceed',
      minutes: 90,
    });
    expect(summaries[1]).toMatchObject({
      label: '数学演習',
      minutes: 20,
    });
  });
});

describe('filterAdminUserSummaries', () => {
  const users: AdminUserSummary[] = [
    {
      profile: {
        id: 'UID-ALPHA',
        email: 'alpha@example.com',
        username: 'Kame',
        avatar: '',
        createdAt: '',
      },
      stats: {
        todayStudyMinutes: 0,
        weekStudyMinutes: 0,
        todayActualCount: 0,
        incompleteTodoCount: 0,
        lastUpdatedAt: null,
      },
    },
    {
      profile: {
        id: 'UID-BETA',
        email: 'beta@example.com',
        username: 'Taro',
        avatar: '',
        createdAt: '',
      },
      stats: {
        todayStudyMinutes: 0,
        weekStudyMinutes: 0,
        todayActualCount: 0,
        incompleteTodoCount: 0,
        lastUpdatedAt: null,
      },
    },
  ];

  it('matches display name, email, and uid without case sensitivity', () => {
    expect(filterAdminUserSummaries(users, 'kAmE')).toHaveLength(1);
    expect(filterAdminUserSummaries(users, 'BETA@EXAMPLE')).toHaveLength(1);
    expect(filterAdminUserSummaries(users, 'uid-alpha')).toHaveLength(1);
  });

  it('returns an empty list when no users match', () => {
    expect(filterAdminUserSummaries(users, 'missing')).toEqual([]);
  });
});
