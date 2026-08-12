import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

const WEEK = [
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
];

function graph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '英単語',
      source: {
        conversationId: 'conversation-adversarial',
        turnId: 'turn-1',
        semanticLocalId: 'task-1',
        sourceText: '英単語を覚える',
        origin: 'user',
      },
      createdRevision: 1,
    }],
  };
}

function wordItem(params: {
  id?: string;
  label?: string;
  amount?: number;
  ordinalStart?: number;
  ordinalEnd?: number;
  durationMinutes?: number;
  workloadFactId?: string;
} = {}): GenericPlanningWorkItem {
  const amount = params.amount ?? 80;
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: params.id ?? 'word-item-1',
    taskId: 'task-1',
    componentId: null,
    workloadFactId: params.workloadFactId ?? 'workload-vocabulary',
    label: params.label ?? `英単語 ${amount}語`,
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount,
      unitCode: 'word',
      unitLabel: '語',
      ordinalRange: {
        start: params.ordinalStart ?? 1,
        end: params.ordinalEnd ?? amount,
      },
      actualRange: null,
    },
    estimatedMinutes: params.durationMinutes ?? 30,
    baseEstimatedMinutes: params.durationMinutes ?? 30,
    calibrationMultiplier: 1,
    roundingStepMinutes: 5,
    estimateBasis: 'direct_effort',
    estimateSourceFactIds: ['effort-1'],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'atomic',
    periodExpression: null,
    sourceFactRefs: ['task-1', params.workloadFactId ?? 'workload-vocabulary', 'effort-1'],
  };
}

function longWorkItem(): GenericPlanningWorkItem {
  return {
    ...wordItem({ id: 'long-item', amount: 180, durationMinutes: 180 }),
    workloadFactId: 'workload-long',
    label: '一般学習 180分',
    quantity: {
      amount: 180,
      unitCode: 'minute',
      unitLabel: '分',
      ordinalRange: null,
      actualRange: null,
    },
    splitPolicy: 'splittable',
    estimateBasis: 'intrinsic_duration',
    sourceFactRefs: ['task-1', 'workload-long'],
  };
}

function input(params: {
  dates?: string[];
  items?: GenericPlanningWorkItem[];
  allowedDates?: string[] | null;
  unavailableDates?: string[];
} = {}): GenericSchedulerInput {
  const dates = params.dates ?? WEEK;
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-adversarial',
    horizon: {
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: params.items ?? [wordItem()],
    fixedTaskReservations: [],
    taskDateEligibilities: params.allowedDates === undefined
      ? []
      : [{
          taskId: 'task-1',
          allowedDates: params.allowedDates,
          excludedDates: [],
          sourceFactIds: ['date-rule-1'],
        }],
    availabilityWindows: (params.unavailableDates ?? []).map((date, index) => ({
      id: `unavailable-${index}`,
      kind: 'unavailable' as const,
      start: { date, time: '09:00' },
      end: { date, time: '22:00' },
      timeZone: 'Asia/Tokyo',
      constraintLevel: 'hard' as const,
      sourceKind: 'user_declaration' as const,
      sourceRef: `unavailable-source-${index}`,
      ownerId: 'owner-adversarial',
      graphRevision: 1,
    })),
    sourceSelections: [],
    relations: [],
    sourceFactRefs: ['task-1'],
  };
}

function role(candidate: { stableV5Metadata?: unknown }): {
  sessionRole?: 'learning' | 'review';
  reviewRound?: 1 | 2;
} {
  return (candidate.stableV5Metadata ?? {}) as {
    sessionRole?: 'learning' | 'review';
    reviewRound?: 1 | 2;
  };
}

function intervalsOverlap(
  left: { date: string; startTime: string; endTime: string },
  right: { date: string; startTime: string; endTime: string },
): boolean {
  return left.date === right.date
    && left.startTime < right.endTime
    && right.startTime < left.endTime;
}

describe('Stable V5 distribution adversarial audit', () => {
  it('does not collapse three legacy-style session chunks onto the first day', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({ items: [longWorkItem()] }),
      graph: graph(),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-08-17',
      '2026-08-19',
      '2026-08-21',
    ]);
    expect(result.candidates.map((candidate) => candidate.durationMinutes)).toEqual([60, 60, 60]);
    expect(result.candidates.some((candidate) => candidate.date === '2026-08-23')).toBe(false);
  });

  it('preserves the 99/100/100 learning split while adding two reviews per batch', () => {
    const items = [
      wordItem({ id: 'word-1', label: '英単語 99語（1/3）', amount: 99, ordinalStart: 1, ordinalEnd: 99 }),
      wordItem({ id: 'word-2', label: '英単語 100語（2/3）', amount: 100, ordinalStart: 100, ordinalEnd: 199 }),
      wordItem({ id: 'word-3', label: '英単語 100語（3/3）', amount: 100, ordinalStart: 200, ordinalEnd: 299 }),
    ];
    const result = scheduleWeeklyPlanningStableV5Preview({ input: input({ items }), graph: graph() });

    expect(result.status).toBe('ready');
    const learning = result.candidates.filter((candidate) => role(candidate).sessionRole === 'learning');
    const reviews = result.candidates.filter((candidate) => role(candidate).sessionRole === 'review');
    expect(learning.map((candidate) => candidate.title)).toEqual([
      '英単語 99語（1/3）',
      '英単語 100語（2/3）',
      '英単語 100語（3/3）',
    ]);
    expect(learning.map((candidate) => candidate.date)).toEqual(WEEK.slice(0, 3));
    expect(reviews).toHaveLength(6);
    expect(new Set(result.candidates.map((candidate) => candidate.stableKey)).size)
      .toBe(result.candidates.length);
    expect(new Set(result.candidates.map((candidate) => candidate.workItemKey)).size)
      .toBe(result.candidates.length);
  });

  it('moves a blocked review later but never earlier than its target day', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({
        items: [wordItem({ durationMinutes: 35 })],
        unavailableDates: ['2026-08-18'],
      }),
      graph: graph(),
    });

    expect(result.status).toBe('ready');
    const firstReview = result.candidates.find((candidate) => role(candidate).reviewRound === 1);
    expect(firstReview).toMatchObject({
      date: '2026-08-19',
      durationMinutes: 20,
    });
    expect(firstReview!.date > '2026-08-17').toBe(true);
  });

  it('uses the seventh day only as a fallback when normal review days are blocked', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({
        unavailableDates: ['2026-08-20', '2026-08-21', '2026-08-22'],
      }),
      graph: graph(),
    });

    expect(result.status).toBe('ready');
    const secondReview = result.candidates.find((candidate) => role(candidate).reviewRound === 2);
    expect(secondReview?.date).toBe('2026-08-23');
  });

  it('respects explicit task-date eligibility for both learning and derived reviews', () => {
    const allowedDates = ['2026-08-17', '2026-08-19', '2026-08-21'];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({ allowedDates }),
      graph: graph(),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates.every((candidate) => allowedDates.includes(candidate.date))).toBe(true);
    expect(result.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-08-17',
      '2026-08-19',
      '2026-08-21',
    ]);
  });

  it('returns no partial preview if a required review cannot fit anywhere', () => {
    const twoDays = WEEK.slice(0, 2);
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({
        dates: twoDays,
        unavailableDates: [twoDays[1]],
      }),
      graph: graph(),
    });

    expect(result.status).toBe('insufficient_capacity');
    expect(result.candidates).toEqual([]);
    expect(result.unscheduledWorkItemIds).toEqual(['word-item-1:review-1']);
  });

  it('degrades review count safely for horizons from one through seven days', () => {
    for (let dayCount = 1; dayCount <= 7; dayCount += 1) {
      const dates = WEEK.slice(0, dayCount);
      const result = scheduleWeeklyPlanningStableV5Preview({
        input: input({ dates }),
        graph: graph(),
      });
      const expectedReviewCount = dayCount >= 3 ? 2 : dayCount === 2 ? 1 : 0;

      expect(result.status, `dayCount=${dayCount}`).toBe('ready');
      expect(
        result.candidates.filter((candidate) => role(candidate).sessionRole === 'learning'),
        `dayCount=${dayCount}`,
      ).toHaveLength(1);
      expect(
        result.candidates.filter((candidate) => role(candidate).sessionRole === 'review'),
        `dayCount=${dayCount}`,
      ).toHaveLength(expectedReviewCount);
      expect(result.candidates.every((candidate) => dates.includes(candidate.date))).toBe(true);
      expect(result.candidates.every((candidate) => candidate.startTime < candidate.endTime)).toBe(true);
      for (let left = 0; left < result.candidates.length; left += 1) {
        for (let right = left + 1; right < result.candidates.length; right += 1) {
          expect(
            intervalsOverlap(result.candidates[left], result.candidates[right]),
            `dayCount=${dayCount}, ${left}/${right}`,
          ).toBe(false);
        }
      }
    }
  });

  it('never places a review before its corresponding learning session', () => {
    const items = [
      wordItem({ id: 'word-1', label: '英単語 70語（1/3）', amount: 70, ordinalStart: 1, ordinalEnd: 70 }),
      wordItem({ id: 'word-2', label: '英単語 70語（2/3）', amount: 70, ordinalStart: 71, ordinalEnd: 140 }),
      wordItem({ id: 'word-3', label: '英単語 80語（3/3）', amount: 80, ordinalStart: 141, ordinalEnd: 220 }),
    ];
    const result = scheduleWeeklyPlanningStableV5Preview({ input: input({ items }), graph: graph() });

    expect(result.status).toBe('ready');
    for (const item of items) {
      const learning = result.candidates.find((candidate) => candidate.workItemKey === item.id);
      const reviews = result.candidates.filter((candidate) => candidate.workItemKey.startsWith(`${item.id}:review-`));
      expect(learning).toBeDefined();
      expect(reviews).toHaveLength(2);
      expect(reviews.every((review) => review.date > learning!.date)).toBe(true);
      expect(reviews.every((review) => review.durationMinutes <= learning!.durationMinutes)).toBe(true);
    }
  });
});
