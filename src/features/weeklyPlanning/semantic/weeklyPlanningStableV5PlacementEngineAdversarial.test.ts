import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  compileGenericPlanningWorkItems,
  type GenericPlanningWorkItem,
} from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { applyWeeklyPlanningCorrectionTransactionV5 } from './weeklyPlanningCorrectionTransactionV5';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from './weeklyPlanningPlacementGraphViewV5';
import {
  scheduleWeeklyPlanningStableV5Preview,
  type WeeklyPlanningStableV5CandidateMetadata,
} from './weeklyPlanningStableV5PreviewScheduler';

const WEEK = [
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
  '2026-08-21', '2026-08-22', '2026-08-23',
];

const source = {
  conversationId: 'conversation-placement-engine',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: 'test',
  origin: 'user' as const,
};

function item(taskId: string, minutes = 60): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: `item-${taskId}`,
    taskId,
    componentId: null,
    workloadFactId: `workload-${taskId}`,
    label: `${taskId} ${minutes}分`,
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: minutes,
      unitCode: 'minute',
      unitLabel: '分',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: minutes,
    estimateBasis: 'intrinsic_duration',
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'atomic',
    periodExpression: null,
    sourceFactRefs: [taskId, `workload-${taskId}`],
  };
}

function graph(taskIds: string[]): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: taskIds.map((taskId) => ({
      id: taskId,
      category: 'study' as const,
      title: taskId,
      source: { ...source, semanticLocalId: taskId },
      createdRevision: 1,
    })),
    workloads: taskIds.map((taskId) => ({
      id: `workload-${taskId}`,
      taskId,
      componentId: null,
      quantityRole: 'target' as const,
      amount: 60,
      unitCode: 'minute' as const,
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: { ...source, semanticLocalId: `workload-${taskId}` },
      createdRevision: 1,
    })),
    factLifecycles: taskIds.flatMap((taskId) => [
      {
        factId: taskId,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: `workload-${taskId}`,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ]),
  };
}

function placementGraph(taskIds: string[]) {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(graph(taskIds)),
  );
}

function input(items: GenericPlanningWorkItem[]): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-placement',
    horizon: {
      startDate: WEEK[0],
      endDate: WEEK[6],
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: items,
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: items.flatMap((value) => value.sourceFactRefs),
  };
}

function twoDayInput(items = [item('task-a'), item('task-b')]): GenericSchedulerInput {
  const value = input(items);
  value.horizon.endDate = WEEK[1];
  value.availabilityWindows = WEEK.slice(0, 2).map((date) => ({
    id: `available:${date}`,
    kind: 'available',
    start: { date, time: '09:00' },
    end: { date, time: '10:00' },
    timeZone: 'Asia/Tokyo',
    constraintLevel: 'hard',
    sourceKind: 'user_declaration',
    sourceRef: `available:${date}`,
    ownerId: value.ownerId,
    graphRevision: value.graphRevision,
  }));
  return value;
}

function deadlineFor(taskId: string, endDate = WEEK[0]): GenericSchedulerInput['hardDateBounds'][number] {
  return { taskId, targetFactId: taskId, startDate: null, endDate, sourceFactIds: [`deadline:${taskId}`] };
}

function placedSchedule(result: ReturnType<typeof scheduleWeeklyPlanningStableV5Preview>) {
  return result.candidates.map((candidate) => ({
    taskId: (candidate as typeof candidate & {
      stableV5Metadata?: WeeklyPlanningStableV5CandidateMetadata;
    }).stableV5Metadata?.taskId,
    date: candidate.date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    durationMinutes: candidate.durationMinutes,
  }));
}

describe('Stable V5 placement engine adversarial integration', () => {
  it('offsets independent singleton tasks instead of piling them onto Monday', () => {
    const taskIds = ['task-a', 'task-b', 'task-c'];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input(taskIds.map((taskId) => item(taskId))),
      graph: placementGraph(taskIds),
    });
    expect(result.status).toBe('ready');
    expect(result.candidates.map((candidate) => candidate.date)).toEqual(WEEK.slice(0, 3));
  });

  it('enforces actual chronology for depends_on when the predecessor is fixed late in the week', () => {
    const value = input([item('task-b')]);
    value.fixedTaskReservations = [{
      id: 'fixed-a',
      taskId: 'task-a',
      start: { date: '2026-08-21', time: '10:00' },
      end: { date: '2026-08-21', time: '11:00' },
      timeZone: 'Asia/Tokyo',
      temporalConstraintFactId: 'fixed-a-fact',
      constraintLevel: 'hard',
      sourceKind: 'user_commitment',
      sourceRef: 'fixed-a-fact',
      graphRevision: 1,
    }];
    value.relations = [{
      factId: 'depends',
      kind: 'depends_on',
      fromTaskId: 'task-b',
      toTaskId: 'task-a',
    }];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value,
      graph: placementGraph(['task-a', 'task-b']),
    });
    expect(result.status).toBe('ready');
    expect(result.candidates[0].date >= '2026-08-21').toBe(true);
    if (result.candidates[0].date === '2026-08-21') {
      expect(result.candidates[0].startTime >= '11:00').toBe(true);
    }
  });

  it('enforces chronology between two movable tasks even when the predecessor is date-constrained', () => {
    const value = input([item('task-a'), item('task-b')]);
    value.taskDateEligibilities = [{
      taskId: 'task-a',
      allowedDates: ['2026-08-21'],
      excludedDates: [],
      sourceFactIds: ['date-a'],
    }];
    value.relations = [{
      factId: 'before',
      kind: 'before',
      fromTaskId: 'task-a',
      toTaskId: 'task-b',
    }];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value,
      graph: placementGraph(['task-a', 'task-b']),
    });
    expect(result.status).toBe('ready');
    const first = result.candidates.find((candidate) => candidate.workItemKey === 'item-task-a')!;
    const second = result.candidates.find((candidate) => candidate.workItemKey === 'item-task-b')!;
    expect(`${second.date}T${second.startTime}` >= `${first.date}T${first.endTime}`).toBe(true);
  });

  it('avoids leaving a ten-minute unusable tail when another clean slot exists', () => {
    const value = input([item('task-a', 120)]);
    value.availabilityWindows = [
      {
        id: 'short-awkward',
        kind: 'available',
        start: { date: WEEK[0], time: '09:00' },
        end: { date: WEEK[0], time: '11:10' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard',
        sourceKind: 'user_declaration',
        sourceRef: 'short-awkward',
        ownerId: 'owner-placement',
        graphRevision: 1,
      },
      {
        id: 'clean',
        kind: 'available',
        start: { date: WEEK[0], time: '13:00' },
        end: { date: WEEK[0], time: '15:00' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard',
        sourceKind: 'user_declaration',
        sourceRef: 'clean',
        ownerId: 'owner-placement',
        graphRevision: 1,
      },
    ];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value,
      graph: placementGraph(['task-a']),
    });
    expect(result.status).toBe('ready');
    expect(result.candidates[0]).toMatchObject({
      date: WEEK[0],
      startTime: '13:00',
      endTime: '15:00',
    });
  });
});

describe('Issue 488 capacity-order boundaries', () => {
  it('finds the feasible two-day plan when the tight deadline is listed last, without widening a soft preference', () => {
    const value = twoDayInput();
    value.hardDateBounds = [deadlineFor('task-b')];
    // A's first-pass Monday load must not leak into the deadline retry.
    value.dailyCapacityLimits = WEEK.slice(0, 2).map((date) => ({
      date, maxMinutes: 60, sourceFactIds: [`capacity:${date}`],
    }));
    value.preferredPlacements = [{
      taskId: 'task-a', targetFactId: 'task-a', dates: [WEEK[0]],
      window: { startMinute: 540, endMinute: 600 }, sourceFactId: 'prefer-a-monday',
    }];
    const view = placementGraph(['task-a', 'task-b']);
    const original = structuredClone({ value, view });
    const result = scheduleWeeklyPlanningStableV5Preview({ input: value, graph: view });

    expect(result.status).toBe('ready');
    expect(result.unscheduledWorkItemIds).toEqual([]);
    expect(placedSchedule(result)).toEqual([
      { taskId: 'task-b', date: WEEK[0], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      { taskId: 'task-a', date: WEEK[1], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
    ]);
    expect(new Set(result.candidates.map((candidate) => candidate.stableKey)).size).toBe(2);
    expect({ value, view }).toEqual(original);
    expect(scheduleWeeklyPlanningStableV5Preview({ input: value, graph: view })).toEqual(result);
  });

  it.each([
    ['before', 'task-a', 'task-b'],
    ['sequence', 'task-a', 'task-b'],
    ['after', 'task-b', 'task-a'],
    ['depends_on', 'task-b', 'task-a'],
  ] as const)('does not turn an impossible %s chronology into a successful deadline retry', (kind, fromTaskId, toTaskId) => {
    const value = twoDayInput();
    value.taskDateEligibilities = [{
      taskId: 'task-a', allowedDates: [WEEK[1]], excludedDates: [], sourceFactIds: ['a-tuesday'],
    }];
    value.hardDateBounds = [deadlineFor('task-b')];
    value.relations = [{ factId: `relation:${kind}`, kind, fromTaskId, toTaskId }];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value, graph: placementGraph(['task-a', 'task-b']),
    });

    expect(result.status).toBe('insufficient_capacity');
    expect(result.candidates).toEqual([]);
    expect(result.unscheduledWorkItemIds).toEqual(['item-task-b']);
  });

  it('can rescue a deadline conflict while still placing a predecessor before its successor', () => {
    const value = twoDayInput([item('task-a'), item('task-b'), item('task-c')]);
    value.horizon.endDate = WEEK[2];
    value.availabilityWindows.push({
      ...value.availabilityWindows[0], id: 'available-wednesday', sourceRef: 'available-wednesday',
      start: { date: WEEK[2], time: '09:00' }, end: { date: WEEK[2], time: '10:00' },
    });
    value.hardDateBounds = [deadlineFor('task-b')];
    value.relations = [{ factId: 'a-before-c', kind: 'before', fromTaskId: 'task-a', toTaskId: 'task-c' }];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value, graph: placementGraph(['task-a', 'task-b', 'task-c']),
    });

    expect(result.status).toBe('ready');
    expect(result.unscheduledWorkItemIds).toEqual([]);
    expect(placedSchedule(result)).toEqual([
      { taskId: 'task-b', date: WEEK[0], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      { taskId: 'task-a', date: WEEK[1], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      { taskId: 'task-c', date: WEEK[2], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
    ]);
  });

  it('keeps an already successful first pass even when deadline order would be different', () => {
    const value = twoDayInput();
    value.hardDateBounds = [deadlineFor('task-b', WEEK[1])];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value, graph: placementGraph(['task-a', 'task-b']),
    });

    expect(result.status).toBe('ready');
    expect(result.unscheduledWorkItemIds).toEqual([]);
    expect(placedSchedule(result)).toEqual([
      { taskId: 'task-a', date: WEEK[0], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      { taskId: 'task-b', date: WEEK[1], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
    ]);
    expect(result).toEqual({
      schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
      status: 'ready',
      unscheduledWorkItemIds: [],
      candidates: ['task-a', 'task-b'].map((taskId, index) => ({
        stableKey: `stable-v5:1:item-${taskId}:0`,
        date: WEEK[index],
        startTime: '09:00',
        endTime: '10:00',
        durationMinutes: 60,
        title: `${taskId} 60分`,
        field: taskId,
        year: 0,
        estimatedMinutes: 60,
        source: 'weekly_exam_prep',
        approvalStatus: 'unapproved',
        workItemKey: `item-${taskId}`,
        stableV5Metadata: {
          runtime: 'stable_v5',
          conversationId: source.conversationId,
          graphRevision: 1,
          taskId,
          sourceFactRefs: [taskId, `workload-${taskId}`],
          planType: 'study',
        },
      })),
    });
  });

  it.each(['daily capacity', 'unavailable time', 'notBefore'] as const)(
    'keeps first-pass partial candidates without loosening %s', (boundary) => {
      const value = twoDayInput();
      value.hardDateBounds = [deadlineFor('task-b')];
      // Capacity/busy retries retain B instead of A if a failed retry is wrongly adopted.
      // notBefore separately preserves priority order, so that retry order is unchanged.
      if (boundary === 'notBefore') {
        value.relations = [{ factId: 'priority-a', kind: 'priority_over', fromTaskId: 'task-a', toTaskId: 'task-b' }];
      }
      if (boundary === 'daily capacity') {
        value.dailyCapacityLimits = [{ date: WEEK[1], maxMinutes: 30, sourceFactIds: ['capacity-tuesday'] }];
      } else if (boundary === 'unavailable time') {
        value.availabilityWindows.push({
          ...value.availabilityWindows[1], id: 'busy-tuesday', kind: 'unavailable', sourceRef: 'busy-tuesday',
        });
      }
      const params = {
        input: value, graph: placementGraph(['task-a', 'task-b']),
        ...(boundary === 'notBefore' ? { notBefore: { date: WEEK[0], time: '09:30' } } : {}),
      };
      const ordinary = scheduleWeeklyPlanningStableV5Preview(params);
      const partial = scheduleWeeklyPlanningStableV5Preview({ ...params, retainPartialCandidates: true });
      expect(ordinary.status).toBe('insufficient_capacity');
      expect(ordinary.candidates).toEqual([]);
      expect(ordinary.unscheduledWorkItemIds).toEqual(['item-task-b']);
      expect(partial.status).toBe('insufficient_capacity');
      expect(partial.unscheduledWorkItemIds).toEqual(['item-task-b']);
      expect(placedSchedule(partial)).toEqual([{
        taskId: 'task-a', date: boundary === 'notBefore' ? WEEK[1] : WEEK[0],
        startTime: '09:00', endTime: '10:00', durationMinutes: 60,
      }]);
    },
  );

  it('keeps task order after a real workload replacement appends the corrected quantity after another task', () => {
    const direct = graph(['task-a', 'task-b']);
    const staged = structuredClone(direct);
    staged.revision = 2;
    staged.workloads[0].amount = 90;
    staged.workloads.push({
      ...staged.workloads[0], id: 'workload-a-replacement', amount: 60, createdRevision: 2,
      source: { ...source, turnId: 'turn-2', semanticLocalId: 'replacement', sourceText: '60分に変更' },
    });
    staged.correctionIntents = [{
      id: 'correction-a', target: { kind: 'workload', factId: 'workload-task-a', publicId: 'workload-task-a', mention: null },
      operation: 'replace', replacementFactId: 'workload-a-replacement', createdRevision: 2,
      source: { ...source, turnId: 'turn-2', semanticLocalId: 'correction', sourceText: '90分ではなく60分' },
    }];
    staged.factLifecycles.push(...['workload-a-replacement', 'correction-a'].map((factId) => ({
      factId, status: 'active' as const, createdRevision: 2, terminalRevision: null, supersededByFactId: null,
    })));
    const before = structuredClone(staged);
    const correction = applyWeeklyPlanningCorrectionTransactionV5({
      graph: staged, expectedRevision: 2, correctionIntentFactId: 'correction-a', operationKey: 'capacity-order-correction',
    });
    expect(correction.status).toBe('applied');
    expect(staged).toEqual(before);
    const correctedView = createWeeklyPlanningActiveSchedulerGraphViewV5(correction.graph);
    // The historical record is not reordered to manufacture the desired compiler output.
    expect(correctedView.workloads.map((workload) => workload.id)).toEqual(['workload-task-b', 'workload-a-replacement']);
    expect(correctedView.workloads.map((workload) => workload.amount)).toEqual([60, 60]);
    const corrected = compileGenericPlanningWorkItems(correctedView);
    const initial = compileGenericPlanningWorkItems(createWeeklyPlanningActiveSchedulerGraphViewV5(direct));
    expect(corrected.readiness).toBe('ready');
    expect(initial.readiness).toBe('ready');
    expect(corrected.items.map((work) => [work.taskId, work.quantity.amount])).toEqual([['task-a', 60], ['task-b', 60]]);
    const first = scheduleWeeklyPlanningStableV5Preview({
      input: twoDayInput(initial.items), graph: placementGraph(['task-a', 'task-b']),
    });
    const correctedInput = twoDayInput(corrected.items);
    correctedInput.graphRevision = correction.graph.revision;
    correctedInput.availabilityWindows = correctedInput.availabilityWindows.map((window) => ({
      ...window, graphRevision: correction.graph.revision,
    }));
    const after = scheduleWeeklyPlanningStableV5Preview({
      input: correctedInput, graph: createWeeklyPlanningPlacementGraphViewV5(correctedView),
    });
    expect(first.status).toBe('ready');
    expect(after.status).toBe('ready');
    expect(placedSchedule(after)).toEqual(placedSchedule(first));
    expect(placedSchedule(first)).toEqual([
      { taskId: 'task-a', date: WEEK[0], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      { taskId: 'task-b', date: WEEK[1], startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
    ]);
  });
});
