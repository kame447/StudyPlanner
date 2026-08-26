import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type PlanningFactLifecycleEntryV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(id: string) {
  return {
    conversationId: 'fixed-interval-target-scope',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function active(factId: string): PlanningFactLifecycleEntryV5 {
  return {
    factId,
    status: 'active',
    createdRevision: 1,
    terminalRevision: null,
    supersededByFactId: null,
  };
}

function graph(targetFactId: 'task-1' | 'component-math'): WeeklyPlanningFactGraphV5 {
  const value: WeeklyPlanningFactGraphV5 = {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '模試対策',
      source: source('task-1'),
      createdRevision: 1,
    }],
    components: [
      {
        id: 'component-math',
        taskId: 'task-1',
        parentComponentId: null,
        role: 'subject',
        label: '数学',
        source: source('component-math'),
        createdRevision: 1,
      },
      {
        id: 'component-english',
        taskId: 'task-1',
        parentComponentId: null,
        role: 'subject',
        label: '英語',
        source: source('component-english'),
        createdRevision: 1,
      },
    ],
    workloads: [
      {
        id: 'workload-math',
        taskId: 'task-1',
        componentId: 'component-math',
        quantityRole: 'target',
        amount: 1,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-math'),
        createdRevision: 1,
      },
      {
        id: 'workload-english',
        taskId: 'task-1',
        componentId: 'component-english',
        quantityRole: 'target',
        amount: 1,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-english'),
        createdRevision: 1,
      },
    ],
    temporalConstraints: [{
      id: 'fixed-math',
      taskId: 'task-1',
      targetFactId,
      kind: 'fixed_interval',
      constraintLevel: 'hard',
      dateExpression: '2026-08-27',
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '19:00',
      precision: 'exact',
      source: source('fixed-math'),
      createdRevision: 1,
    }],
    factLifecycles: [
      active('task-1'),
      active('component-math'),
      active('component-english'),
      active('workload-math'),
      active('workload-english'),
      active('fixed-math'),
    ],
  };
  return value;
}

function compile(value: WeeklyPlanningFactGraphV5) {
  return compileGenericSchedulerInput({
    graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value),
    context: {
      ownerId: 'owner-1',
      currentDate: '2026-08-26',
      planningStartDate: '2026-08-27',
      planningEndDate: '2026-08-27',
      timeZone: 'Asia/Tokyo',
    },
  });
}

describe('weekly planning fixed interval target scope', () => {
  it('keeps sibling component work movable when only one component is fixed', () => {
    const result = compile(graph('component-math'));

    expect(result.status).toBe('ready');
    expect(result.input?.fixedTaskReservations).toHaveLength(1);
    expect(result.input?.movableWorkItems.map((item) => item.componentId)).toEqual([
      'component-english',
    ]);
  });

  it('keeps task-level fixed interval inherited by all component work', () => {
    const result = compile(graph('task-1'));

    expect(result.status).toBe('ready');
    expect(result.input?.fixedTaskReservations).toHaveLength(1);
    expect(result.input?.movableWorkItems).toEqual([]);
  });
});
