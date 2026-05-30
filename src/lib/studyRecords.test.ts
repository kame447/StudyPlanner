import { describe, expect, it } from 'vitest';
import {
  buildMonthlyStudySeriesInRange,
  buildWeeklyStudySeries,
  calculateTodayStudyMinutes,
} from './studyAnalytics';
import { normalizeStudyRecordsForDisplay } from './studyRecords';
import type { Actual, Plan, StudyMaterial, StudySubject } from '../types/domain';

const timestamp = '2026-05-01T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: '数学演習',
    subject: '数学',
    date: '2026-05-04',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: null,
    occurrenceDate: '2026-05-04',
    actualStartTime: '09:00',
    actualEndTime: '10:00',
    title: '数学演習',
    subject: '数学',
    isAlignedToPlan: false,
    note: '',
    updatedAt: timestamp,
    ...overrides,
  };
}

const subjects: StudySubject[] = [
  {
    id: 'subject-math',
    userId: 'user-1',
    name: '数学',
    color: '#2f6fc2',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

const materials: StudyMaterial[] = [
  {
    id: 'material-chart',
    userId: 'user-1',
    name: '青チャート',
    subjectId: 'subject-math',
    subjectName: '数学',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

describe('normalizeStudyRecordsForDisplay', () => {
  it('normalizes planned and standalone actuals into the same display shape', () => {
    const records = normalizeStudyRecordsForDisplay({
      plans: [
        plan({
          id: 'plan-linked',
          materialId: 'material-chart',
          materialName: '青チャート',
        }),
      ],
      actuals: [
        actual({
          id: 'actual-linked',
          planId: 'plan-linked',
          title: '',
          subject: '',
          actualStartTime: '09:10',
          actualEndTime: '09:50',
        }),
        actual({
          id: 'actual-standalone',
          planId: null,
          occurrenceDate: '2026-05-04',
          title: '英単語',
          subject: '英語',
          actualStartTime: '20:00',
          actualEndTime: '20:30',
        }),
      ],
      subjects,
      materials,
      startDate: '2026-05-04',
      endDate: '2026-05-04',
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      actualId: 'actual-linked',
      planId: 'plan-linked',
      linkKind: 'planned',
      label: '数学演習',
      subjectLabel: '数学',
      materialLabel: '青チャート',
      durationMinutes: 40,
    });
    expect(records[1]).toMatchObject({
      actualId: 'actual-standalone',
      planId: null,
      linkKind: 'standalone',
      label: '英単語',
      subjectLabel: '英語',
      durationMinutes: 30,
    });
  });

  it('uses a non-empty fallback when label and subject are missing', () => {
    const records = normalizeStudyRecordsForDisplay({
      plans: [],
      actuals: [
        actual({
          id: 'actual-empty',
          title: '',
          subject: '',
          materialId: '',
          materialName: '',
        }),
      ],
    });

    expect(records[0]).toMatchObject({
      label: '記録',
      subjectLabel: '記録',
      durationMinutes: 60,
    });
  });
});

describe('study record aggregation', () => {
  it('counts planned and planId-null records in daily, weekly, and monthly totals', () => {
    const plans = [plan({ id: 'plan-linked' })];
    const actuals = [
      actual({
        id: 'actual-linked',
        planId: 'plan-linked',
        actualStartTime: '09:00',
        actualEndTime: '09:45',
      }),
      actual({
        id: 'actual-null-plan',
        planId: null,
        occurrenceDate: '2026-05-04',
        actualStartTime: '20:00',
        actualEndTime: '20:30',
      }),
    ];

    expect(calculateTodayStudyMinutes('2026-05-04', plans, actuals)).toBe(75);
    expect(
      buildWeeklyStudySeries('2026-05-04', plans, actuals).find(
        (entry) => entry.date === '2026-05-04',
      )?.minutes,
    ).toBe(75);
    expect(
      buildMonthlyStudySeriesInRange('2026-05-01', '2026-05-01', plans, actuals)[0]
        .minutes,
    ).toBe(75);
  });
});
