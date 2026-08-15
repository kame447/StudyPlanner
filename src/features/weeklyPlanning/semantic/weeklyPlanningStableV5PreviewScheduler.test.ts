import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  GenericPlanningWorkItem,
} from './weeklyPlanningGenericWorkItems';
import type {
  GenericSchedulerInput,
} from './weeklyPlanningGenericSchedulerInput';
import {
  scheduleWeeklyPlanningStableV5Preview,
} from './weeklyPlanningStableV5PreviewScheduler';

function workItem(overrides: Partial<GenericPlanningWorkItem> = {}): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: 'work-item-1',
    taskId: 'task-1',
    componentId: null,
    workloadFactId: 'workload-1',
    label: '部屋の掃除 60分',
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: 60,
      unitCode: 'minute',
      unitLabel: '分',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: 60,
    estimateBasis: 'intrinsic_duration',
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'splittable',
    periodExpression: null,
    sourceFactRefs: ['task-1', 'workload-1'],
    ...overrides,
  };
}

function vocabularyWorkItem(params: {
  index: number;
  amount: number;
  start: number;
  end: number;
}): GenericPlanningWorkItem {
  return workItem({
    id: `vocabulary-${params.index}`,
    taskId: 'task-vocabulary',
    workloadFactId: 'workload-vocabulary',
    label: `英単語 ${params.amount}語（${params.start}〜${params.end}語）`,
    quantity: {
      amount: params.amount,
      unitCode: 'word',
      unitLabel: '語',
      ordinalRange: { start: params.start, end: params.end },
      actualRange: null,
    },
    estimatedMinutes: 60,
    estimateBasis: 'direct_effort',
    splitPolicy: 'atomic',
    sourceFactRefs: ['task-vocabulary', 'workload-vocabulary', 'effort-vocabulary'],
  });
}

function schedulerInput(overrides: Partial<GenericSchedulerInput> = {}): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-07-27',
      endDate: '2026-07-27',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [workItem()],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    sourceFactRefs: ['task-1', 'workload-1'],
    ...overrides,
  };
}

function graph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'non_study',
      title: '部屋の掃除',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'task-local-1',
        sourceText: '部屋の掃除を1時間する',
        origin: 'user',
      },
      createdRevision: 1,
    }],
  };
}

function vocabularyGraph(preferredPeriod?: 'evening'): WeeklyPlanningFactGraphV5 {
  const source = {
    conversationId: 'conversation-vocabulary',
    turnId: 'turn-1',
    semanticLocalId: 'vocabulary',
    sourceText: '英単語220語',
    origin: 'user' as const,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: preferredPeriod ? 2 : 1,
    tasks: [{
      id: 'task-vocabulary',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }],
    ...(preferredPeriod ? {
      temporalConstraints: [{
        id: 'preferred-vocabulary-time',
        taskId: 'task-vocabulary',
        targetFactId: 'task-vocabulary',
        kind: 'preferred_window' as const,
        constraintLevel: 'soft' as const,
        dateExpression: null,
        namedTimePeriod: preferredPeriod,
        startTime: null,
        endTime: null,
        precision: 'unspecified' as const,
        source: {
          ...source,
          turnId: 'turn-2',
          semanticLocalId: 'preferred-vocabulary-time',
          sourceText: 'できれば夕方にしたい',
        },
        createdRevision: 2,
      }],
      factLifecycles: [{
        factId: 'preferred-vocabulary-time',
        status: 'active' as const,
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      }],
    } : {}),
  };
}

function existingPlan(): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'owner-1',
    title: '既存予定',
    subject: '',
    date: '2026-07-27',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: '',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function sessionRole(candidate: unknown): 'learning' | 'review' | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const metadata = (candidate as { stableV5Metadata?: { sessionRole?: unknown } }).stableV5Metadata;
  return metadata?.sessionRole === 'learning' || metadata?.sessionRole === 'review'
    ? metadata.sessionRole
    : null;
}

function startMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

describe('Stable V5 preview scheduler', () => {
  it('places application work after an existing plan without sending placement to AI', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: graph(),
      plans: [existingPlan()],
    });

    expect(result.status).toBe('ready');
    expect(result.unscheduledWorkItemIds).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      date: '2026-07-27',
      startTime: '10:20',
      endTime: '11:20',
      durationMinutes: 60,
      title: '部屋の掃除 60分',
      field: '部屋の掃除',
    });
    expect((result.candidates[0] as typeof result.candidates[0] & {
      stableV5Metadata?: { runtime: string; conversationId: string; planType: string };
    }).stableV5Metadata).toMatchObject({
      runtime: 'stable_v5',
      conversationId: 'conversation-1',
      planType: 'other',
    });
  });

  it('returns no partial preview when the available capacity is insufficient', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        availabilityWindows: [{
          id: 'available-1',
          kind: 'available',
          start: { date: '2026-07-27', time: '09:00' },
          end: { date: '2026-07-27', time: '09:30' },
          timeZone: 'Asia/Tokyo',
          constraintLevel: 'hard',
          sourceKind: 'user_declaration',
          sourceRef: 'availability-fact-1',
          ownerId: 'owner-1',
          graphRevision: 1,
        }],
      }),
      graph: graph(),
    });

    expect(result.status).toBe('insufficient_capacity');
    expect(result.candidates).toEqual([]);
    expect(result.unscheduledWorkItemIds).toEqual(['work-item-1']);
  });

  it('lets an explicit preferred night window outrank the default daytime heuristic', () => {
    const preferredGraph: WeeklyPlanningFactGraphV5 = {
      ...graph(),
      revision: 2,
      temporalConstraints: [{
        id: 'preferred-night-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'preferred_window',
        constraintLevel: 'soft',
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: 'night',
        startTime: null,
        endTime: null,
        precision: 'unspecified',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-2',
          semanticLocalId: 'preferred-local-1',
          sourceText: '火曜の夜にして',
          origin: 'user',
        },
        createdRevision: 2,
      }],
      factLifecycles: [{
        factId: 'preferred-night-1',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      }],
    };
    const item = workItem({
      estimatedMinutes: 180,
      estimateBasis: 'direct_effort',
      splitPolicy: 'unknown',
      quantity: {
        amount: 50,
        unitCode: 'page',
        unitLabel: 'ページ',
        ordinalRange: { start: 1, end: 50 },
        actualRange: null,
      },
    });
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        graphRevision: 2,
        horizon: {
          startDate: '2026-08-17',
          endDate: '2026-08-23',
          timeZone: 'Asia/Tokyo',
          planningWindowFactIds: [],
        },
        movableWorkItems: [item],
      }),
      graph: preferredGraph,
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      date: '2026-08-18',
      startTime: '21:00',
      endTime: '24:00',
      durationMinutes: 180,
    });
  });

  it('uses morning, afternoon and night as soft defaults for three vocabulary learning sessions', () => {
    const items = [
      vocabularyWorkItem({ index: 1, amount: 74, start: 1, end: 74 }),
      vocabularyWorkItem({ index: 2, amount: 73, start: 75, end: 147 }),
      vocabularyWorkItem({ index: 3, amount: 73, start: 148, end: 220 }),
    ];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        horizon: {
          startDate: '2026-08-17',
          endDate: '2026-08-23',
          timeZone: 'Asia/Tokyo',
          planningWindowFactIds: [],
        },
        movableWorkItems: items,
        sourceFactRefs: ['task-vocabulary', 'workload-vocabulary', 'effort-vocabulary'],
      }),
      graph: vocabularyGraph(),
    });

    expect(result.status).toBe('ready');
    const learning = result.candidates.filter((candidate) => sessionRole(candidate) === 'learning');
    expect(learning).toHaveLength(3);
    const starts = learning.map((candidate) => startMinutes(candidate.startTime));
    expect(starts.some((minutes) => minutes >= 9 * 60 && minutes < 12 * 60)).toBe(true);
    expect(starts.some((minutes) => minutes >= 12 * 60 && minutes < 17 * 60)).toBe(true);
    expect(starts.some((minutes) => minutes >= 21 * 60)).toBe(true);
  });

  it('lets an explicit vocabulary evening preference override the default daypart', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        graphRevision: 2,
        horizon: {
          startDate: '2026-08-17',
          endDate: '2026-08-23',
          timeZone: 'Asia/Tokyo',
          planningWindowFactIds: [],
        },
        movableWorkItems: [vocabularyWorkItem({ index: 1, amount: 80, start: 1, end: 80 })],
        sourceFactRefs: ['task-vocabulary', 'workload-vocabulary', 'effort-vocabulary'],
      }),
      graph: vocabularyGraph('evening'),
    });

    expect(result.status).toBe('ready');
    const learning = result.candidates.find((candidate) => sessionRole(candidate) === 'learning');
    expect(learning).toMatchObject({
      startTime: '17:00',
      endTime: '18:00',
      durationMinutes: 60,
    });
  });
});
