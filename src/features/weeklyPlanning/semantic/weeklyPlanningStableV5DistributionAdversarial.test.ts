import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from './weeklyPlanningPlacementGraphViewV5';
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
    factLifecycles: [{
      factId: 'task-1',
      status: 'active',
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    }],
  };
}

function placementGraph() {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(graph()),
  );
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
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: ['task-1'],
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
  it('does not collapse a generic long workload onto the first day', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({ items: [longWorkItem()] }),
      graph: placementGraph(),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
    expect(result.candidates.map((candidate) => candidate.durationMinutes)).toEqual([60, 60, 60]);
    expect(result.candidates.some((candidate) => candidate.date === '2026-08-23')).toBe(false);
  });

  it('schedules only explicitly supplied vocabulary work items and derives no reviews', () => {
    const items = [
      wordItem({ id: 'word-1', label: '英単語 99語', amount: 99, ordinalStart: 1, ordinalEnd: 99 }),
      wordItem({ id: 'word-2', label: '英単語 100語', amount: 100, ordinalStart: 100, ordinalEnd: 199 }),
      wordItem({ id: 'word-3', label: '英単語 100語', amount: 100, ordinalStart: 200, ordinalEnd: 299 }),
    ];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({ items }),
      graph: placementGraph(),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(items.length);
    expect(new Set(result.candidates.map((candidate) => candidate.workItemKey))).toEqual(
      new Set(items.map((item) => item.id)),
    );
    expect(result.candidates.some((candidate) => candidate.workItemKey.includes(':review-'))).toBe(false);
    expect(new Set(result.candidates.map((candidate) => candidate.stableKey)).size)
      .toBe(result.candidates.length);
  });

  it('does not invent a review when a later date is unavailable', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({
        items: [wordItem({ durationMinutes: 35 })],
        unavailableDates: ['2026-08-18'],
      }),
      graph: placementGraph(),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      workItemKey: 'word-item-1',
      durationMinutes: 35,
    });
    expect(result.candidates.some((candidate) => candidate.workItemKey.includes(':review-'))).toBe(false);
  });

  it('respects explicit task-date eligibility without deriving extra vocabulary sessions', () => {
    const allowedDates = ['2026-08-17', '2026-08-19', '2026-08-21'];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({ allowedDates }),
      graph: placementGraph(),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(allowedDates).toContain(result.candidates[0].date);
    expect(result.candidates[0].workItemKey).toBe('word-item-1');
  });

  it('keeps a schedulable vocabulary item ready even when later review dates are unavailable', () => {
    const twoDays = WEEK.slice(0, 2);
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input({
        dates: twoDays,
        unavailableDates: [twoDays[1]],
      }),
      graph: placementGraph(),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].workItemKey).toBe('word-item-1');
    expect(result.unscheduledWorkItemIds).toEqual([]);
  });

  it('never creates overlapping derived sessions for vocabulary across one-to-seven-day horizons', () => {
    for (let dayCount = 1; dayCount <= 7; dayCount += 1) {
      const dates = WEEK.slice(0, dayCount);
      const result = scheduleWeeklyPlanningStableV5Preview({
        input: input({ dates }),
        graph: placementGraph(),
      });

      expect(result.status, `dayCount=${dayCount}`).toBe('ready');
      expect(result.candidates, `dayCount=${dayCount}`).toHaveLength(1);
      expect(result.candidates[0].workItemKey, `dayCount=${dayCount}`).toBe('word-item-1');
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
});
