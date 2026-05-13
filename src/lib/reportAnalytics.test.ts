import { describe, expect, it } from 'vitest';
import {
  buildMonthWeekComparisons,
  buildRangeDailyComparisons,
  buildReportSummary,
  buildYearMonthComparisons,
  getMaterialChartEntries,
  OTHER_MATERIAL_LABEL,
  UNSET_MATERIAL_LABEL,
} from './reportAnalytics';
import type { Actual, Plan, StudyMaterial, StudySubject } from '../types/domain';

const baseTimestamp = '2026-05-01T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: 'Base plan',
    subject: 'Math',
    date: '2026-05-04',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp,
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
    title: 'Base actual',
    subject: 'Math',
    isAlignedToPlan: false,
    note: '',
    updatedAt: baseTimestamp,
    ...overrides,
  };
}

function subject(overrides: Partial<StudySubject> = {}): StudySubject {
  return {
    id: 'subject-math',
    userId: 'user-1',
    name: 'Math',
    color: '#2f6fc2',
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp,
    ...overrides,
  };
}

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'material-1',
    userId: 'user-1',
    name: 'Math Workbook',
    subjectId: 'subject-math',
    subjectName: 'Math',
    status: 'active',
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp,
    ...overrides,
  };
}

const subjects = [
  subject(),
  subject({
    id: 'subject-english',
    name: 'English',
    color: '#d9824f',
  }),
];

const materials = [
  material(),
  material({
    id: 'material-english',
    name: 'English Reader',
    subjectId: 'subject-english',
    subjectName: 'English',
  }),
];

describe('buildReportSummary material totals', () => {
  it('groups registered material records by material name', () => {
    const summary = buildReportSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      plans: [],
      actuals: [
        actual({
          materialId: 'material-1',
          materialName: '',
          actualStartTime: '10:00',
          actualEndTime: '11:30',
        }),
      ],
      subjects,
      materials,
    });

    expect(summary.materialTotals).toHaveLength(1);
    expect(summary.materialTotals[0]).toMatchObject({
      key: 'material:material-1',
      label: 'Math Workbook',
      minutes: 90,
      subject: 'Math',
    });
  });

  it('uses titles as provisional materials and combines matching titles', () => {
    const summary = buildReportSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      plans: [],
      actuals: [
        actual({
          id: 'actual-title-1',
          title: 'Vocabulary drills',
          subject: 'English',
          actualStartTime: '09:00',
          actualEndTime: '09:30',
        }),
        actual({
          id: 'actual-title-2',
          title: 'Vocabulary drills',
          subject: 'English',
          occurrenceDate: '2026-05-05',
          actualStartTime: '20:00',
          actualEndTime: '20:45',
        }),
      ],
      subjects,
      materials,
    });

    expect(summary.materialTotals).toHaveLength(1);
    expect(summary.materialTotals[0]).toMatchObject({
      key: 'title:Vocabulary drills',
      label: 'Vocabulary drills',
      minutes: 75,
      subject: 'English',
    });
  });

  it('uses unset only when both material and title are absent', () => {
    const summary = buildReportSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      plans: [],
      actuals: [
        actual({
          title: '',
          subject: '',
          materialId: '',
          materialName: '',
        }),
      ],
      subjects,
      materials,
    });

    expect(summary.materialTotals).toHaveLength(1);
    expect(summary.materialTotals[0].label).toBe(UNSET_MATERIAL_LABEL);
    expect(summary.materialUnsetCount).toBe(1);
  });

  it('uses the linked plan material when the actual has no material', () => {
    const linkedPlan = plan({
      id: 'plan-linked',
      title: 'Plan title',
      materialId: 'material-english',
      materialName: 'English Reader',
      subject: 'English',
    });
    const summary = buildReportSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      plans: [linkedPlan],
      actuals: [
        actual({
          id: 'actual-linked',
          planId: 'plan-linked',
          occurrenceDate: '2026-05-04',
          title: '',
          subject: '',
          materialId: '',
          materialName: '',
          actualStartTime: '09:00',
          actualEndTime: '09:40',
        }),
      ],
      subjects,
      materials,
    });

    expect(summary.materialTotals).toHaveLength(1);
    expect(summary.materialTotals[0]).toMatchObject({
      key: 'material:material-english',
      label: 'English Reader',
      minutes: 40,
      subject: 'English',
    });
    expect(summary.materialUnsetCount).toBe(0);
  });

  it('keeps top material entries and folds the rest into other', () => {
    const entries = getMaterialChartEntries(
      Array.from({ length: 7 }, (_, index) => ({
        key: `material-${index + 1}`,
        label: `Material ${index + 1}`,
        minutes: 70 - index * 10,
        ratio: 0,
      })),
    );

    expect(entries).toHaveLength(6);
    expect(entries.slice(0, 5).map((entry) => entry.label)).toEqual([
      'Material 1',
      'Material 2',
      'Material 3',
      'Material 4',
      'Material 5',
    ]);
    expect(entries[5]).toMatchObject({
      label: OTHER_MATERIAL_LABEL,
      minutes: 30,
    });
  });
});

describe('report period comparisons', () => {
  it('builds correct daily comparisons for a week range', () => {
    const comparisons = buildRangeDailyComparisons({
      startDate: '2026-05-04',
      endDate: '2026-05-10',
      plans: [plan({ id: 'plan-mon', date: '2026-05-04' })],
      actuals: [
        actual({
          id: 'actual-mon',
          planId: 'plan-mon',
          occurrenceDate: '2026-05-04',
          actualStartTime: '09:00',
          actualEndTime: '09:45',
        }),
        actual({
          id: 'actual-tue',
          occurrenceDate: '2026-05-05',
          actualStartTime: '20:00',
          actualEndTime: '20:20',
        }),
      ],
      subjects,
      materials,
    });

    expect(comparisons).toHaveLength(7);
    expect(comparisons[0]).toMatchObject({
      key: '2026-05-04',
      plannedMinutes: 60,
      actualMinutes: 45,
    });
    expect(comparisons[1]).toMatchObject({
      key: '2026-05-05',
      plannedMinutes: 0,
      actualMinutes: 20,
    });
  });

  it('builds correct weekly comparisons for a month', () => {
    const comparisons = buildMonthWeekComparisons({
      selectedDate: '2026-05-13',
      plans: [plan({ id: 'plan-week-2', date: '2026-05-04' })],
      actuals: [
        actual({
          id: 'actual-week-2',
          planId: 'plan-week-2',
          occurrenceDate: '2026-05-04',
        }),
        actual({
          id: 'actual-week-4',
          occurrenceDate: '2026-05-20',
          actualStartTime: '21:00',
          actualEndTime: '21:30',
        }),
      ],
      subjects,
      materials,
    });

    expect(comparisons).toHaveLength(5);
    expect(comparisons.find((entry) => entry.key === '2026-05-04')).toMatchObject({
      plannedMinutes: 60,
      actualMinutes: 60,
    });
    expect(comparisons.find((entry) => entry.key === '2026-05-18')).toMatchObject({
      plannedMinutes: 0,
      actualMinutes: 30,
    });
  });

  it('builds correct monthly comparisons for a year', () => {
    const comparisons = buildYearMonthComparisons({
      selectedDate: '2026-05-13',
      plans: [
        plan({
          id: 'plan-feb',
          date: '2026-02-01',
          startTime: '09:00',
          endTime: '10:30',
        }),
      ],
      actuals: [
        actual({
          id: 'actual-feb',
          planId: 'plan-feb',
          occurrenceDate: '2026-02-01',
          actualStartTime: '09:00',
          actualEndTime: '10:00',
        }),
        actual({
          id: 'actual-dec',
          occurrenceDate: '2026-12-15',
          actualStartTime: '20:00',
          actualEndTime: '20:30',
        }),
      ],
      subjects,
      materials,
    });

    expect(comparisons).toHaveLength(12);
    expect(comparisons[1]).toMatchObject({
      key: '2026-02-01',
      plannedMinutes: 90,
      actualMinutes: 60,
    });
    expect(comparisons[11]).toMatchObject({
      key: '2026-12-01',
      plannedMinutes: 0,
      actualMinutes: 30,
    });
  });
});

describe('report summary metrics', () => {
  it('calculates totals, achievement, difference, unrecorded and standalone entries', () => {
    const recordedPlan = plan({
      id: 'plan-recorded',
      date: '2026-05-04',
      startTime: '09:00',
      endTime: '10:00',
    });
    const unrecordedPlan = plan({
      id: 'plan-unrecorded',
      date: '2026-05-04',
      startTime: '10:00',
      endTime: '10:30',
    });
    const summary = buildReportSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      plans: [recordedPlan, unrecordedPlan],
      actuals: [
        actual({
          id: 'actual-recorded',
          planId: 'plan-recorded',
          occurrenceDate: '2026-05-04',
          actualStartTime: '09:00',
          actualEndTime: '09:30',
        }),
        actual({
          id: 'actual-standalone',
          occurrenceDate: '2026-05-05',
          actualStartTime: '20:00',
          actualEndTime: '20:45',
        }),
      ],
      subjects,
      materials,
    });

    expect(summary.plannedMinutes).toBe(90);
    expect(summary.actualMinutes).toBe(75);
    expect(summary.achievementRate).toBeCloseTo(83.333, 3);
    expect(summary.differenceMinutes).toBe(-15);
    expect(summary.unrecordedPlans.map((entry) => entry.id)).toEqual([
      'plan-unrecorded',
    ]);
    expect(summary.standaloneActuals.map((entry) => entry.id)).toEqual([
      'actual-standalone',
    ]);
    expect(summary.learningDays).toBe(2);
  });

  it('does not break for zero-minute actuals', () => {
    const summary = buildReportSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      plans: [],
      actuals: [
        actual({
          actualStartTime: '09:00',
          actualEndTime: '09:00',
          title: 'Zero minutes',
        }),
      ],
      subjects,
      materials,
    });

    expect(summary.actualMinutes).toBe(0);
    expect(summary.learningDays).toBe(0);
    expect(getMaterialChartEntries(summary.materialTotals)).toEqual([]);
  });

  it('returns safe empty values when there is no data', () => {
    const summary = buildReportSummary({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      plans: [],
      actuals: [],
      subjects: [],
      materials: [],
    });

    expect(summary.plannedMinutes).toBe(0);
    expect(summary.actualMinutes).toBe(0);
    expect(summary.achievementRate).toBeNull();
    expect(summary.differenceMinutes).toBe(0);
    expect(summary.materialTotals).toEqual([]);
    expect(summary.unrecordedPlans).toEqual([]);
    expect(summary.standaloneActuals).toEqual([]);
  });
});
