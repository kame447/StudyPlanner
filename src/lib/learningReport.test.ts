import { describe, expect, it } from 'vitest';
import {
  ALL_MATERIALS_FILTER,
  buildLearningReportMaterialOptions,
  buildLearningReportModel,
  buildLearningReportOverview,
  formatLearningReportRangeLabel,
  getLearningReportRange,
  shiftLearningReportAnchor,
} from './learningReport';
import type { Actual, Plan, StudyMaterial, StudySubject } from '../types/domain';

const timestamp = '2026-08-01T00:00:00.000Z';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: '学習予定',
    subject: '情報科学',
    date: '2026-08-24',
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

function makeActual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: null,
    occurrenceDate: '2026-08-24',
    actualStartTime: '09:00',
    actualEndTime: '10:00',
    title: '学習記録',
    subject: '情報科学',
    isAlignedToPlan: false,
    note: '',
    updatedAt: timestamp,
    ...overrides,
  };
}

const subjects: StudySubject[] = [
  {
    id: 'subject-info',
    userId: 'user-1',
    name: '情報科学',
    color: '#7b61d1',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'subject-math',
    userId: 'user-1',
    name: '数学',
    color: '#2f74c8',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

const materials: StudyMaterial[] = [
  {
    id: 'material-algo',
    userId: 'user-1',
    name: 'アルゴリズムイントロダクション',
    subjectId: 'subject-info',
    subjectName: '情報科学',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'material-math',
    userId: 'user-1',
    name: '線形代数',
    subjectId: 'subject-math',
    subjectName: '数学',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

describe('learning report ranges', () => {
  it('builds Monday-start week ranges and shifts by the selected scope', () => {
    expect(getLearningReportRange('week', '2026-08-26')).toEqual({
      startDate: '2026-08-24',
      endDate: '2026-08-30',
    });
    expect(shiftLearningReportAnchor('day', '2026-08-26', -1)).toBe(
      '2026-08-25',
    );
    expect(shiftLearningReportAnchor('week', '2026-08-26', 1)).toBe(
      '2026-09-02',
    );
    expect(shiftLearningReportAnchor('month', '2026-08-26', 1)).toBe(
      '2026-09-01',
    );
  });

  it('formats the visible range without changing the source date', () => {
    expect(formatLearningReportRangeLabel('day', '2026-08-26')).toBe(
      '2026年08月26日',
    );
    expect(formatLearningReportRangeLabel('week', '2026-08-26')).toBe(
      '2026年08月24日〜2026年08月30日',
    );
    expect(formatLearningReportRangeLabel('month', '2026-08-26')).toBe(
      '2026年08月',
    );
  });
});

describe('learning report overview', () => {
  it('uses the same study-record duration rules for today, week, month and lifetime', () => {
    const overview = buildLearningReportOverview({
      referenceDate: '2026-08-26',
      plans: [
        makePlan({ id: 'plan-today', date: '2026-08-26' }),
        makePlan({ id: 'plan-week', date: '2026-08-24' }),
        makePlan({ id: 'plan-month', date: '2026-08-10' }),
      ],
      actuals: [
        makeActual({
          id: 'actual-today',
          planId: 'plan-today',
          occurrenceDate: '2026-08-26',
          actualStartTime: '09:00',
          actualEndTime: '10:30',
        }),
        makeActual({
          id: 'actual-week',
          planId: 'plan-week',
          occurrenceDate: '2026-08-24',
          actualStartTime: '10:00',
          actualEndTime: '11:00',
        }),
        makeActual({
          id: 'actual-month',
          planId: 'plan-month',
          occurrenceDate: '2026-08-10',
          actualStartTime: '08:00',
          actualEndTime: '08:45',
        }),
        makeActual({
          id: 'actual-old',
          occurrenceDate: '2026-07-01',
          actualStartTime: '18:00',
          actualEndTime: '18:30',
        }),
      ],
      subjects,
      materials,
    });

    expect(overview.todayMinutes).toBe(90);
    expect(overview.weekMinutes).toBe(150);
    expect(overview.monthMinutes).toBe(195);
    expect(overview.lifetimeMinutes).toBe(225);
    expect(overview.todayPlannedMinutes).toBe(60);
    expect(overview.weekPlannedMinutes).toBe(120);
    expect(overview.monthPlannedMinutes).toBe(180);
  });
});

describe('learning report model', () => {
  const plans = [
    makePlan({
      id: 'plan-algo-mon',
      date: '2026-08-24',
      materialId: 'material-algo',
      materialName: 'アルゴリズムイントロダクション',
    }),
    makePlan({
      id: 'plan-math-tue',
      date: '2026-08-25',
      subject: '数学',
      materialId: 'material-math',
      materialName: '線形代数',
    }),
  ];
  const actuals = [
    makeActual({
      id: 'actual-algo-mon',
      planId: 'plan-algo-mon',
      occurrenceDate: '2026-08-24',
      materialId: 'material-algo',
      materialName: 'アルゴリズムイントロダクション',
      actualStartTime: '09:00',
      actualEndTime: '10:30',
    }),
    makeActual({
      id: 'actual-math-tue',
      planId: 'plan-math-tue',
      occurrenceDate: '2026-08-25',
      subject: '数学',
      materialId: 'material-math',
      materialName: '線形代数',
      actualStartTime: '13:00',
      actualEndTime: '14:00',
    }),
  ];

  it('keeps period total, trend buckets and breakdown totals consistent', () => {
    const report = buildLearningReportModel({
      scope: 'week',
      anchorDate: '2026-08-26',
      materialFilter: ALL_MATERIALS_FILTER,
      plans,
      actuals,
      subjects,
      materials,
    });

    expect(report.actualMinutes).toBe(150);
    expect(
      report.buckets.reduce((sum, bucket) => sum + bucket.actualMinutes, 0),
    ).toBe(report.actualMinutes);
    expect(
      report.breakdown.reduce((sum, entry) => sum + entry.minutes, 0),
    ).toBe(report.actualMinutes);
    expect(report.buckets).toHaveLength(7);
    expect(report.breakdown.map((entry) => entry.label)).toEqual([
      'アルゴリズムイントロダクション',
      '線形代数',
    ]);
  });

  it('filters actuals and planned time using the same registered material key', () => {
    const report = buildLearningReportModel({
      scope: 'week',
      anchorDate: '2026-08-26',
      materialFilter: 'material:material-algo',
      plans,
      actuals,
      subjects,
      materials,
    });

    expect(report.actualMinutes).toBe(90);
    expect(report.plannedMinutes).toBe(60);
    expect(report.breakdown).toHaveLength(1);
    expect(report.breakdown[0]).toMatchObject({
      key: 'material:material-algo',
      minutes: 90,
      ratio: 1,
    });
    expect(
      report.buckets.reduce((sum, bucket) => sum + bucket.actualMinutes, 0),
    ).toBe(90);
  });

  it('uses individual sessions as the day trend buckets', () => {
    const report = buildLearningReportModel({
      scope: 'day',
      anchorDate: '2026-08-24',
      materialFilter: ALL_MATERIALS_FILTER,
      plans,
      actuals: [
        actuals[0],
        makeActual({
          id: 'actual-algo-evening',
          occurrenceDate: '2026-08-24',
          materialId: 'material-algo',
          materialName: 'アルゴリズムイントロダクション',
          actualStartTime: '19:00',
          actualEndTime: '19:30',
        }),
      ],
      subjects,
      materials,
    });

    expect(report.buckets.map((bucket) => bucket.label)).toEqual([
      '09:00',
      '19:00',
    ]);
    expect(report.actualMinutes).toBe(120);
  });

  it('groups records without a material by subject instead of using the record title', () => {
    const report = buildLearningReportModel({
      scope: 'day',
      anchorDate: '2026-08-24',
      materialFilter: ALL_MATERIALS_FILTER,
      plans: [],
      actuals: [
        makeActual({
          id: 'actual-subject-only',
          title: '動的計画法の復習',
          subject: '情報科学',
          materialId: null,
          materialName: '',
        }),
      ],
      subjects,
      materials,
    });

    expect(report.actualMinutes).toBe(60);
    expect(report.breakdown).toHaveLength(1);
    expect(report.breakdown[0]).toMatchObject({
      key: 'subject:情報科学',
      label: '情報科学',
      subject: '情報科学',
      minutes: 60,
      ratio: 1,
    });
    expect(
      report.breakdown.reduce((sum, entry) => sum + entry.minutes, 0),
    ).toBe(report.actualMinutes);
  });
});

describe('learning report material options', () => {
  it('starts with all materials and uses stable material ids as filter values', () => {
    expect(buildLearningReportMaterialOptions(materials)).toEqual([
      { value: ALL_MATERIALS_FILTER, label: 'すべての教材' },
      {
        value: 'material:material-algo',
        label: 'アルゴリズムイントロダクション',
      },
      { value: 'material:material-math', label: '線形代数' },
    ]);
  });
});
