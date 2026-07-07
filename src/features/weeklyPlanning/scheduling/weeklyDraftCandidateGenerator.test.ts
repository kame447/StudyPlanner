import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningRemainingWorkItem } from '../intake/weeklyPlanningRemainingWorkItems';
import type { Plan, ScheduleTemplate } from '../../../types/domain';
import { createWeeklyDraftCandidatesFromRemainingWorkItems } from './weeklyDraftCandidateGenerator';
import { expandRecurringUnavailableConstraints } from './weeklyPlanningConstraintScheduling';

const remainingWorkItems: WeeklyPlanningRemainingWorkItem[] = [
  {
    field: '数学・数理系',
    year: 2020,
    estimatedMinutes: 120,
    unit: 'year_field_chunk',
    splitPolicy: 'atomic',
    source: 'exam_prep_request',
  },
  {
    field: '数学・数理系',
    year: 2019,
    estimatedMinutes: 120,
    unit: 'year_field_chunk',
    splitPolicy: 'atomic',
    source: 'exam_prep_request',
  },
  {
    field: 'ソフトウェア系',
    year: 2025,
    estimatedMinutes: 120,
    unit: 'year_field_chunk',
    splitPolicy: 'atomic',
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

function plan(overrides: Partial<Plan>): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: 'バイト',
    subject: 'バイト',
    date: '2026-06-30',
    startTime: '20:00',
    endTime: '22:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: '',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function scheduleTemplate(overrides: Partial<ScheduleTemplate>): ScheduleTemplate {
  return {
    id: 'template-1',
    userId: 'user-1',
    title: '計算理論',
    subject: '計算理論',
    type: 'school-event',
    weekday: 'tue',
    startTime: '10:20',
    endTime: '11:50',
    termId: 'term-1',
    periodNumber: 2,
    classroom: 'A101',
    memo: '',
    active: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function hasCandidateOverlap(params: {
  result: ReturnType<typeof createWeeklyDraftCandidatesFromRemainingWorkItems>;
  date: string;
  startTime: string;
  endTime: string;
}): boolean {
  const startMinutes = Number(params.startTime.slice(0, 2)) * 60 + Number(params.startTime.slice(3, 5));
  const endMinutes = Number(params.endTime.slice(0, 2)) * 60 + Number(params.endTime.slice(3, 5));

  return params.result.candidates.some((candidate) => {
    const candidateStart = Number(candidate.startTime.slice(0, 2)) * 60 + Number(candidate.startTime.slice(3, 5));
    const candidateEnd = Number(candidate.endTime.slice(0, 2)) * 60 + Number(candidate.endTime.slice(3, 5));

    return candidate.date === params.date && candidateStart < endMinutes && startMinutes < candidateEnd;
  });
}

describe('weekly draft candidate generator dry-run', () => {

  function oneHourAtomicWorkItems(count: number): WeeklyPlanningRemainingWorkItem[] {
    return Array.from({ length: count }, (_, index) => ({
      field: 'math',
      year: 2020 - index,
      estimatedMinutes: 60,
      unit: 'year_field_chunk' as const,
      splitPolicy: 'atomic' as const,
      source: 'exam_prep_request' as const,
    }));
  }

  it('keeps the relative seventh day as reserve when normal work fits in the first six days', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: oneHourAtomicWorkItems(6),
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-07-01',
      planningDayCount: 7,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '10:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
      '2026-07-06',
    ]);
    expect(result.candidates.some((candidate) => candidate.date === '2026-07-07')).toBe(false);
    expect(result.diagnostics.reserveDate).toBe('2026-07-07');
    expect(result.diagnostics.normalPlacementDayCount).toBe(6);
    expect(result.diagnostics.reserveDayUsed).toBe(false);
  });

  it('uses the reserve day only for overflow that does not fit in the first six days', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: oneHourAtomicWorkItems(7),
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-07-01',
      planningDayCount: 7,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '10:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
      '2026-07-06',
      '2026-07-07',
    ]);
    expect(result.diagnostics.reserveDate).toBe('2026-07-07');
    expect(result.diagnostics.reserveDayUsed).toBe(true);
    expect(result.diagnostics.decisionTrace).toContain('reserve-day-used:2026-07-07');
    expect(result.diagnostics.unscheduledItems).toEqual([]);
  });

  it('keeps reserve-day hard constraints in the planning window when overflow uses the reserve day', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: oneHourAtomicWorkItems(13),
      constraints: [],
      fixedEvents: [
        {
          kind: 'fixed_event' as const,
          date: '2026-07-07',
          start: '09:00',
          end: '10:00',
          hardness: 'hard' as const,
          rawText: 'reserve day event',
        },
      ],
      planningStartDate: '2026-07-01',
      planningDayCount: 7,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '11:00',
        breakMinutes: 0,
      },
    });

    expect(result.diagnostics.reserveDate).toBe('2026-07-07');
    expect(result.diagnostics.reserveDayUsed).toBe(true);
    expect(result.candidates[result.candidates.length - 1]).toEqual(expect.objectContaining({
      date: '2026-07-07',
      startTime: '10:00',
      endTime: '11:00',
    }));
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
  });

  it('treats the final planning-window day as reserve regardless of weekday', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: oneHourAtomicWorkItems(6),
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-07-02',
      planningDayCount: 7,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '10:00',
        breakMinutes: 0,
      },
    });

    expect(result.diagnostics.reserveDate).toBe('2026-07-08');
    expect(result.candidates.some((candidate) => candidate.date === '2026-07-08')).toBe(false);
    expect(result.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
      '2026-07-06',
      '2026-07-07',
    ]);
  });

  it('keeps short planning windows fully available instead of treating the final day as reserve', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: oneHourAtomicWorkItems(3),
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-07-01',
      planningDayCount: 3,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '10:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
    expect(result.diagnostics.reserveDate).toBeUndefined();
    expect(result.diagnostics.normalPlacementDayCount).toBe(3);
    expect(result.diagnostics.reserveDayUsed).toBe(false);
  });

  it('uses study available start as the daily placement lower bound separately from sleep end', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          field: '数学・数理系',
          year: 2020,
          estimatedMinutes: 60,
          unit: 'year_field_chunk',
          splitPolicy: 'atomic',
          source: 'exam_prep_request',
        },
      ],
      constraints: [
        {
          kind: 'sleep',
          end: '08:00',
          studyAvailableStart: '10:00',
          hardness: 'hard',
          rawText: '普段は8時に起きて、10時から勉強できる',
        },
      ],
      fixedEvents: [],
      planningStartDate: '2026-06-30',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '08:00',
        dayStartTime: '08:00',
        dayEndTime: '12:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-30',
        startTime: '10:00',
        endTime: '11:00',
      }),
    ]);
  });

  it('falls back to dayStartTime when study available start is unspecified', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          field: '数学・数理系',
          year: 2020,
          estimatedMinutes: 60,
          unit: 'year_field_chunk',
          splitPolicy: 'atomic',
          source: 'exam_prep_request',
        },
      ],
      constraints: [
        {
          kind: 'sleep',
          end: '08:00',
          hardness: 'hard',
          rawText: '8時起床',
        },
      ],
      fixedEvents: [],
      planningStartDate: '2026-06-30',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '08:00',
        dayStartTime: '08:00',
        dayEndTime: '12:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-30',
        startTime: '08:00',
        endTime: '09:00',
      }),
    ]);
  });

  it('avoids existing plans as hard busy intervals with the legacy buffer', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          field: '数学・数理系',
          year: 2020,
          estimatedMinutes: 60,
          unit: 'year_field_chunk',
          splitPolicy: 'atomic',
          source: 'exam_prep_request',
        },
      ],
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-06-30',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '20:30',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
      existingPlans: [
        plan({
          date: '2026-06-30',
          startTime: '20:00',
          endTime: '22:00',
        }),
      ],
    });

    expect(hasCandidateOverlap({
      result,
      date: '2026-06-30',
      startTime: '20:00',
      endTime: '22:00',
    })).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.unscheduledItems).toHaveLength(1);
  });

  it('avoids active timetable templates as hard busy intervals in the new intake generator', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          field: '数学・数理系',
          year: 2020,
          estimatedMinutes: 120,
          unit: 'year_field_chunk',
          splitPolicy: 'atomic',
          source: 'exam_prep_request',
        },
      ],
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-06-30',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '13:00',
        breakMinutes: 0,
      },
      scheduleTemplates: [scheduleTemplate({})],
      timetableTermId: 'term-1',
    });

    expect(hasCandidateOverlap({
      result,
      date: '2026-06-30',
      startTime: '10:20',
      endTime: '11:50',
    })).toBe(false);
    expect(result.diagnostics.constraintConflicts).toEqual([]);
  });

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


  it('keeps atomic year-field work items as a single block even when longer than max session', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          field: '数学・数理系',
          year: 2020,
          estimatedMinutes: 180,
          unit: 'year_field_chunk',
          splitPolicy: 'atomic',
          source: 'exam_prep_request',
        },
      ],
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-06-26',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '13:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates.map((candidate) => ({
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      durationMinutes: candidate.durationMinutes,
      stableKey: candidate.stableKey,
    }))).toEqual([
      {
        startTime: '09:00',
        endTime: '12:00',
        durationMinutes: 180,
        stableKey: '数学・数理系:2020:chunk-0',
      },
    ]);
    expect(result.diagnostics.unscheduledItems).toEqual([]);
  });

  it('keeps splittable total-minute work items on the existing session chunking path', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          field: '数学・数理系',
          year: 2020,
          estimatedMinutes: 180,
          unit: 'minutes' as const,
          splitPolicy: 'splittable' as const,
          source: 'exam_prep_request',
        },
      ],
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-06-26',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '13:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates.map((candidate) => candidate.durationMinutes)).toEqual([120, 60]);
    expect(result.diagnostics.unscheduledItems).toEqual([]);
  });

  it('reports an atomic work item as unscheduled instead of splitting when no slot can fit it', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        {
          field: '数学・数理系',
          year: 2020,
          estimatedMinutes: 180,
          unit: 'year_field_chunk',
          splitPolicy: 'atomic',
          source: 'exam_prep_request',
        },
      ],
      constraints: [],
      fixedEvents: [],
      planningStartDate: '2026-06-26',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '09:00',
        dayStartTime: '09:00',
        dayEndTime: '11:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.unscheduledItems).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        year: 2020,
        estimatedMinutes: 180,
        unit: 'year_field_chunk',
        splitPolicy: 'atomic',
      }),
    ]);
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
          unit: 'minutes' as const,
          splitPolicy: 'splittable' as const,
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


  it('expands date-less meal time bands across all planning days before scheduling', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        { ...remainingWorkItems[0], estimatedMinutes: 60 },
        { ...remainingWorkItems[1], estimatedMinutes: 60 },
      ],
      constraints: [
        {
          kind: 'meal' as const,
          start: '19:00',
          end: '20:00',
          hardness: 'hard' as const,
          rawText: '夜ご飯 19:00-20:00',
        },
      ],
      fixedEvents: [],
      planningStartDate: '2026-06-26',
      planningDayCount: 2,
      sessionPolicy: {
        firstDayStartTime: '19:00',
        dayStartTime: '19:00',
        dayEndTime: '21:00',
        breakMinutes: 0,
      },
    });

    expect(hasCandidateOverlap({
      result,
      date: '2026-06-26',
      startTime: '19:00',
      endTime: '20:00',
    })).toBe(false);
    expect(hasCandidateOverlap({
      result,
      date: '2026-06-27',
      startTime: '19:00',
      endTime: '20:00',
    })).toBe(false);
    expect(result.candidates.map((candidate) => ({
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
    }))).toEqual([
      { date: '2026-06-26', startTime: '20:00', endTime: '21:00' },
      { date: '2026-06-27', startTime: '20:00', endTime: '21:00' },
    ]);
  });

  it('expands date-less sleep time bands across all planning days before scheduling', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [
        { ...remainingWorkItems[0], estimatedMinutes: 60 },
        { ...remainingWorkItems[1], estimatedMinutes: 60 },
      ],
      constraints: [
        {
          kind: 'sleep' as const,
          start: '00:00',
          end: '08:00',
          hardness: 'hard' as const,
          rawText: '睡眠 0:00-8:00',
        },
      ],
      fixedEvents: [],
      planningStartDate: '2026-06-26',
      planningDayCount: 2,
      sessionPolicy: {
        firstDayStartTime: '00:00',
        dayStartTime: '00:00',
        dayEndTime: '09:00',
        breakMinutes: 0,
      },
    });

    expect(hasCandidateOverlap({
      result,
      date: '2026-06-26',
      startTime: '00:00',
      endTime: '08:00',
    })).toBe(false);
    expect(hasCandidateOverlap({
      result,
      date: '2026-06-27',
      startTime: '00:00',
      endTime: '08:00',
    })).toBe(false);
    expect(result.candidates.map((candidate) => ({
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
    }))).toEqual([
      { date: '2026-06-26', startTime: '08:00', endTime: '09:00' },
      { date: '2026-06-27', startTime: '08:00', endTime: '09:00' },
    ]);
  });

  it('keeps time-unspecified variable meal constraints floating instead of scheduling them', () => {
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      ...baseInput,
      remainingWorkItems: [{ ...remainingWorkItems[0], estimatedMinutes: 60 }],
      constraints: [
        {
          kind: 'meal' as const,
          hardness: 'soft' as const,
          rawText: '夜ご飯は日によって違う',
        },
      ],
      fixedEvents: [],
      planningStartDate: '2026-06-26',
      planningDayCount: 2,
      sessionPolicy: {
        firstDayStartTime: '19:00',
        dayStartTime: '19:00',
        dayEndTime: '21:00',
        breakMinutes: 0,
      },
    });

    expect(result.diagnostics.decisionTrace).toContain(
      'floating-meal-constraint:夜ご飯は日によって違う',
    );
    expect(result.candidates).toEqual([
      expect.objectContaining({
        date: '2026-06-26',
        startTime: '19:00',
        endTime: '20:00',
      }),
    ]);
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
