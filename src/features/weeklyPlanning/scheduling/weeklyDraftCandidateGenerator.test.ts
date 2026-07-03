import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningRemainingWorkItem } from '../intake/weeklyPlanningRemainingWorkItems';
import { createWeeklyDraftCandidatesFromRemainingWorkItems } from './weeklyDraftCandidateGenerator';
import { expandRecurringUnavailableConstraints } from './weeklyPlanningConstraintScheduling';

const remainingWorkItems: WeeklyPlanningRemainingWorkItem[] = [
  {
    field: '数学・数理系',
    year: 2020,
    estimatedMinutes: 120,
    unit: 'year_field_chunk',
    source: 'exam_prep_request',
  },
  {
    field: '数学・数理系',
    year: 2019,
    estimatedMinutes: 120,
    unit: 'year_field_chunk',
    source: 'exam_prep_request',
  },
  {
    field: 'ソフトウェア系',
    year: 2025,
    estimatedMinutes: 120,
    unit: 'year_field_chunk',
    source: 'exam_prep_request',
  },
];

const baseInput = {
  remainingWorkItems,
  constraints: [
    {
      kind: 'meal' as const,
      date: '2026-06-26',
      end: '19:00',
      hardness: 'hard' as const,
      rawText: '今日のご飯は19時までに済ます',
    },
    {
      kind: 'bath' as const,
      durationMinutes: 30,
      hardness: 'soft' as const,
      rawText: 'お風呂を考慮',
    },
    {
      kind: 'buffer' as const,
      durationMinutes: 30,
      hardness: 'soft' as const,
      rawText: '寝る時間を考慮',
    },
  ],
  fixedEvents: [
    {
      kind: 'fixed_event' as const,
      date: '2026-06-26',
      start: '19:00',
      durationMinutes: 60,
      hardness: 'hard' as const,
      rawText: '19時から病院がある',
    },
  ],
  planningStartDate: '2026-06-26',
  planningDayCount: 2,
  sessionPolicy: {
    firstDayStartTime: '19:00',
    dayStartTime: '09:00',
    dayEndTime: '22:00',
    breakMinutes: 0,
  },
};

describe('weekly draft candidate generator dry-run', () => {
  it('creates unapproved deterministic candidates while preserving field order and avoiding constraints', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems(baseInput);

    expect(result.candidates.map((candidate) => ({
      field: candidate.field,
      year: candidate.year,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      approvalStatus: candidate.approvalStatus,
      source: candidate.source,
    }))).toEqual([
      {
        field: '数学・数理系',
        year: 2020,
        date: '2026-06-26',
        startTime: '20:00',
        endTime: '22:00',
        approvalStatus: 'unapproved',
        source: 'weekly_exam_prep',
      },
      {
        field: '数学・数理系',
        year: 2019,
        date: '2026-06-27',
        startTime: '09:00',
        endTime: '11:00',
        approvalStatus: 'unapproved',
        source: 'weekly_exam_prep',
      },
      {
        field: 'ソフトウェア系',
        year: 2025,
        date: '2026-06-27',
        startTime: '11:00',
        endTime: '13:00',
        approvalStatus: 'unapproved',
        source: 'weekly_exam_prep',
      },
    ]);
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
    expect(result.diagnostics.lifeConstraintConflicts).toEqual([]);
    expect(result.diagnostics.fieldOrderPreserved).toBe(true);
    expect(result.diagnostics.completedYearsExcluded).toBe(true);
    expect(result.diagnostics.shouldSavePlan).toBe(false);
    expect(result.diagnostics.decisionTrace).toEqual(
      expect.arrayContaining([
        'floating-bath-constraint:お風呂を考慮',
        'floating-buffer-constraint:寝る時間を考慮',
      ]),
    );
  });

  it('keeps total scheduled minutes consistent and never exceeds requested minutes', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems(baseInput);
    const candidateMinutes = result.candidates.reduce(
      (sum, candidate) => sum + candidate.durationMinutes,
      0,
    );

    expect(result.diagnostics.totalRequestedMinutes).toBe(360);
    expect(result.diagnostics.totalScheduledMinutes).toBe(candidateMinutes);
    expect(result.diagnostics.totalScheduledMinutes).toBeLessThanOrEqual(
      result.diagnostics.totalRequestedMinutes,
    );
  });

  it('splits long work items without using randomness or external state', () => {
    const longItemInput = {
      ...baseInput,
      remainingWorkItems: [
        {
          ...remainingWorkItems[0],
          estimatedMinutes: 240,
        },
      ],
      fixedEvents: [],
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    };
    const first = createWeeklyDraftCandidatesFromRemainingWorkItems(longItemInput);
    const second = createWeeklyDraftCandidatesFromRemainingWorkItems(longItemInput);

    expect(first).toEqual(second);
    expect(first.candidates.map((candidate) => candidate.durationMinutes)).toEqual([120, 120]);
  });

  it('expands date-less unavailable constraints into each planning day as a pure scheduling helper', () => {
    expect(expandRecurringUnavailableConstraints({
      constraints: [
        {
          kind: 'unavailable' as const,
          start: '16:00',
          end: '19:00',
          hardness: 'hard' as const,
        },
      ],
      planningStartDate: '2026-06-26',
      planningDayCount: 3,
    }).map((constraint) => constraint.date)).toEqual([
      '2026-06-26',
      '2026-06-27',
      '2026-06-28',
    ]);
  });
  it('expands date-less unavailable time bands across planning days before scheduling', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [remainingWorkItems[0]],
      constraints: [],
      fixedEvents: [
        {
          kind: 'unavailable' as const,
          start: '16:00',
          end: '19:00',
          hardness: 'hard' as const,
          rawText: '\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067',
        },
      ],
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '16:00',
        dayStartTime: '16:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-26',
        startTime: '19:00',
        endTime: '21:00',
      }),
    ]);
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
  });

  it('treats all-day unavailable dates as busy and moves candidates to later days', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [remainingWorkItems[0]],
      constraints: [],
      fixedEvents: [
        {
          kind: 'unavailable' as const,
          date: '2026-06-26',
          start: '00:00',
          end: '24:00',
          hardness: 'hard' as const,
          rawText: '\u91d1\u66dc\u306f\u4f7f\u308f\u306a\u3044\u3067',
        },
      ],
      planningDayCount: 2,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-27',
        startTime: '09:00',
        endTime: '11:00',
      }),
    ]);
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
  });

  it('pins current implicit busy interval inference for start-only constraints', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [remainingWorkItems[0]],
      constraints: [],
      fixedEvents: [
        {
          kind: 'fixed_event' as const,
          date: '2026-06-26',
          start: '09:00',
          hardness: 'hard' as const,
          rawText: 'event starts at 09:00',
        },
      ],
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '12:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-26',
        startTime: '10:00',
        endTime: '12:00',
      }),
    ]);
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
  });

  it('pins current implicit busy interval inference for end plus duration constraints', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          ...remainingWorkItems[0],
          estimatedMinutes: 60,
        },
      ],
      constraints: [],
      fixedEvents: [
        {
          kind: 'fixed_event' as const,
          date: '2026-06-26',
          end: '11:00',
          durationMinutes: 60,
          hardness: 'hard' as const,
          rawText: 'event ends at 11:00',
        },
      ],
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '10:00',
        dayStartTime: '10:00',
        dayEndTime: '12:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-26',
        startTime: '11:00',
        endTime: '12:00',
      }),
    ]);
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
  });

  it('pins current implicit busy interval inference for meal end-only constraints', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          ...remainingWorkItems[0],
          estimatedMinutes: 60,
        },
      ],
      constraints: [
        {
          kind: 'meal' as const,
          date: '2026-06-26',
          end: '19:00',
          hardness: 'hard' as const,
          rawText: 'meal ends at 19:00',
        },
      ],
      fixedEvents: [],
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '18:00',
        dayStartTime: '18:00',
        dayEndTime: '20:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-26',
        startTime: '19:00',
        endTime: '20:00',
      }),
    ]);
    expect(result.diagnostics.lifeConstraintConflicts).toEqual([]);
  });

  it('reports unscheduled items when unavailable constraints block the whole planning window', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [remainingWorkItems[0]],
      constraints: [],
      fixedEvents: [
        {
          kind: 'unavailable' as const,
          start: '09:00',
          end: '22:00',
          hardness: 'hard' as const,
          rawText: '\u7d42\u65e5\u4f7f\u308f\u306a\u3044',
        },
      ],
      planningDayCount: 2,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.unscheduledItems).toEqual([remainingWorkItems[0]]);
    expect(result.diagnostics.totalScheduledMinutes).toBe(0);
  });
  it('reports unscheduled items instead of over-scheduling when the planning window is too small', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '21:00',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.unscheduledItems).toEqual(remainingWorkItems);
    expect(result.diagnostics.totalScheduledMinutes).toBe(0);
  });
});