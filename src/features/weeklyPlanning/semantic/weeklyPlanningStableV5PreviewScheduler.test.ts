import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  GenericPlanningWorkItem,
} from './weeklyPlanningGenericWorkItems';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInput,
} from './weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from './weeklyPlanningPlacementGraphViewV5';
import {
  scheduleWeeklyPlanningStableV5Preview,
} from './weeklyPlanningStableV5PreviewScheduler';

function active(factId: string, createdRevision = 1) {
  return {
    factId,
    status: 'active' as const,
    createdRevision,
    terminalRevision: null,
    supersededByFactId: null,
  };
}

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
    hardDateBounds: [],
    preferredPlacements: [],
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
    factLifecycles: [active('task-1')],
  };
}

function placementGraph(value: WeeklyPlanningFactGraphV5) {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(value),
  );
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
      factLifecycles: [
        active('task-vocabulary'),
        active('preferred-vocabulary-time', 2),
      ],
    } : {
      factLifecycles: [active('task-vocabulary')],
    }),
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

describe('Stable V5 preview scheduler', () => {
  it('places application work after an existing plan without sending placement to AI', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: placementGraph(graph()),
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
      graph: placementGraph(graph()),
    });

    expect(result.status).toBe('insufficient_capacity');
    expect(result.candidates).toEqual([]);
    expect(result.unscheduledWorkItemIds).toEqual(['work-item-1']);
  });

  it('lets a compiled preferred night window outrank the default daytime heuristic', () => {
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
      factLifecycles: [
        active('task-1'),
        active('preferred-night-1', 2),
      ],
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
        preferredPlacements: [{
          taskId: 'task-1',
          targetFactId: 'task-1',
          dates: ['2026-08-18'],
          window: { startMinute: 21 * 60, endMinute: 24 * 60 },
          sourceFactId: 'preferred-night-1',
        }],
      }),
      graph: placementGraph(preferredGraph),
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

  it('lets a compiled vocabulary evening preference control placement without an automatic vocabulary schedule', () => {
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
        preferredPlacements: [{
          taskId: 'task-vocabulary',
          targetFactId: 'task-vocabulary',
          dates: [
            '2026-08-17',
            '2026-08-18',
            '2026-08-19',
            '2026-08-20',
            '2026-08-21',
            '2026-08-22',
            '2026-08-23',
          ],
          window: { startMinute: 17 * 60, endMinute: 21 * 60 },
          sourceFactId: 'preferred-vocabulary-time',
        }],
        sourceFactRefs: ['task-vocabulary', 'workload-vocabulary', 'effort-vocabulary'],
      }),
      graph: placementGraph(vocabularyGraph('evening')),
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      startTime: '17:00',
      endTime: '18:00',
      durationMinutes: 60,
    });
  });
});

// Source responsibility: 2125b22e, plan-wide preference reaches actual placement.
// Adapt its preference/hard-constraint controls to this suite's current fixture;
// no source-wide conversation harness, provider call or new scheduling policy.
describe('accepted plan-wide preferred availability reaches ordinary placement', () => {
  it.each([
    { name: 'rank the accepted evening preference', expectedStart: '20:00', busy: false, available: false, blocked: false },
    { name: 'hard unavailable wins within the preferred period', expectedStart: '21:10', busy: true, available: false, blocked: false },
    { name: 'soft preference never expands hard availability', expectedStart: '10:00', busy: false, available: true, blocked: false },
    { name: 'blocked soft preference can fall back to ordinary free time', expectedStart: '09:00', busy: false, available: false, blocked: true },
  ])('$name', ({ expectedStart, busy, available, blocked }) => {
    const value = graph();
    const source = value.tasks[0].source;
    value.workloads = [{
      id: 'c1-work', taskId: 'task-1', componentId: null, quantityRole: 'target',
      amount: 45, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, source, createdRevision: 1,
    }];
    value.planningWindows = [{ id: 'c1-window', kind: 'absolute', value: '2026-07-27/2026-07-27',
      start: '2026-07-27', end: '2026-07-27', source, createdRevision: 1 }];
    const preference = {
      id: 'c1-preferred', kind: 'preferred' as const, dateExpression: '2026-07-27',
      namedTimePeriod: null, startTime: '20:00', endTime: '22:00', recurrenceKind: null,
      days: [], constraintLevel: 'soft' as const, capacityMinutes: null, resolutionStatus: 'unresolved' as const, source, createdRevision: 1,
    };
    value.availabilityDeclarations = [preference];
    if (busy || blocked) value.availabilityDeclarations.push({ ...preference, id: 'c1-unavailable',
      kind: 'unavailable', constraintLevel: 'hard', endTime: blocked ? '22:00' : '21:00' });
    if (available) value.availabilityDeclarations.push({ ...preference, id: 'c1-available',
      kind: 'available', constraintLevel: 'hard', startTime: '10:00', endTime: '12:00' });
    value.factLifecycles.push(active('c1-work'), active('c1-window'),
      ...value.availabilityDeclarations.map(row => active(row.id)));
    const frozen = JSON.stringify(value);
    const compilation = compileGenericSchedulerInput({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value),
      context: { ownerId: 'owner-1', currentDate: '2026-07-26', planningStartDate: '2026-07-27',
        planningEndDate: '2026-07-27', timeZone: 'Asia/Tokyo' },
    });
    expect(compilation.status).toBe('ready');
    expect(compilation.issues).toEqual([]);
    expect(compilation.input).not.toBeNull();
    const input = compilation.input!;
    expect(input.movableWorkItems).toHaveLength(1);
    expect(input.movableWorkItems[0]).toMatchObject({ taskId: 'task-1', workloadFactId: 'c1-work', estimatedMinutes: 45 });
    if (!available && !blocked) expect(input.preferredPlacements).toEqual([{
      taskId: 'task-1', targetFactId: 'task-1', dates: ['2026-07-27'],
      window: { startMinute: 1200, endMinute: 1320 }, sourceFactId: 'c1-preferred',
    }]);
    const result = scheduleWeeklyPlanningStableV5Preview({ input, graph: placementGraph(value), plans: [] });
    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ date: '2026-07-27', startTime: expectedStart, durationMinutes: 45 });
    expect(JSON.stringify(value)).toBe(frozen);
  });
});
