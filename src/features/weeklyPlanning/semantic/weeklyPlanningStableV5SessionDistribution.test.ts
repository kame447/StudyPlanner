import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { distributeGenericSchedulerWorkItemsV5 } from './weeklyPlanningSchedulerWorkDistributionV5';

const source = {
  conversationId: 'conversation-session-distribution',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: '3時間',
  origin: 'user' as const,
};

function graphWithHours(params: {
  hours: number;
  purpose?: 'research' | 'self_study';
}): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  return {
    ...graph,
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '作業',
      source,
      createdRevision: 1,
    }],
    studyContexts: params.purpose
      ? [{
          id: 'context-1',
          taskId: 'task-1',
          purpose: params.purpose,
          contextLabel: null,
          source,
          createdRevision: 1,
        }]
      : [],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole: 'target',
      amount: params.hours,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
  };
}

function distribute(graph: WeeklyPlanningFactGraph, preferredSessionMinutes?: number) {
  const work = compileGenericPlanningWorkItems(graph);
  return distributeGenericSchedulerWorkItemsV5({
    graph,
    items: work.items,
    startDate: '2026-08-17',
    endDate: '2026-08-23',
    preferredSessionMinutes,
  });
}

describe('Stable V5 execution-policy work distribution', () => {
  it('splits three neutral hours into two 90-minute quantity-preserving sessions', () => {
    const result = distribute(graphWithHours({ hours: 3 }));
    expect(result.map((item) => item.estimatedMinutes)).toEqual([90, 90]);
    expect(result.map((item) => item.quantity.amount)).toEqual([1.5, 1.5]);
    expect(result.map((item) => item.label)).toEqual([
      '作業 1.5時間（1/2）',
      '作業 1.5時間（2/2）',
    ]);
    expect(result.every((item) => item.splitPolicy === 'atomic')).toBe(true);
  });

  it('uses structured research purpose to keep longer deep-work sessions', () => {
    const result = distribute(graphWithHours({ hours: 3.5, purpose: 'research' }));
    expect(result.map((item) => item.estimatedMinutes)).toEqual([105, 105]);
  });

  it('honors a bounded personalized session target without changing total work', () => {
    const result = distribute(graphWithHours({ hours: 2.5 }), 75);
    expect(result.map((item) => item.estimatedMinutes)).toEqual([75, 75]);
    expect(result.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(150);
    expect(result.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(2.5);
  });
});
