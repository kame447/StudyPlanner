import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { distributeGenericSchedulerWorkItemsV5 } from './weeklyPlanningSchedulerWorkDistributionV5';

function vocabularyGraph(params: {
  amount: number;
  minutes: number;
  effortKind?: 'total_duration' | 'session_duration';
}): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  const source = {
    conversationId: 'conversation-vocabulary',
    turnId: 'turn-1',
    semanticLocalId: 'vocabulary',
    sourceText: `英単語${params.amount}語`,
    origin: 'user' as const,
  };
  const effortKind = params.effortKind ?? 'total_duration';
  return {
    ...graph,
    revision: 1,
    tasks: [{
      id: 'task-vocabulary',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-vocabulary',
      taskId: 'task-vocabulary',
      componentId: null,
      quantityRole: 'target',
      amount: params.amount,
      unitCode: 'word',
      unitLabel: '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'estimate-vocabulary',
      taskId: 'task-vocabulary',
      targetFactId: 'workload-vocabulary',
      kind: effortKind,
      minutes: params.minutes,
      unitCode: effortKind === 'session_duration' ? 'word' : null,
      precision: 'approximate',
      source,
      createdRevision: 1,
    }],
  };
}

function distribute(graph: WeeklyPlanningFactGraph) {
  const compiled = compileGenericPlanningWorkItems(graph);
  return {
    compiled,
    distributed: distributeGenericSchedulerWorkItemsV5({
      graph,
      items: compiled.items,
      startDate: '2026-08-17',
      endDate: '2026-08-23',
    }),
  };
}

describe('vocabulary time-based work distribution', () => {
  it('keeps vocabulary as one aggregate work item until total effort is known', () => {
    const graph = vocabularyGraph({ amount: 220, minutes: 180 });
    const { compiled } = distribute(graph);

    expect(compiled.readiness).toBe('ready');
    expect(compiled.issues).toEqual([]);
    expect(compiled.items).toHaveLength(1);
    expect(compiled.items[0]).toMatchObject({
      quantity: {
        amount: 220,
        unitCode: 'word',
        ordinalRange: { start: 1, end: 220 },
      },
      estimatedMinutes: 180,
      estimateSourceFactIds: ['estimate-vocabulary'],
    });
  });

  it('derives vocabulary session count from total minutes, not from a word-count ceiling', () => {
    const graph = vocabularyGraph({ amount: 220, minutes: 180 });
    const { distributed } = distribute(graph);

    expect(distributed.map((item) => item.estimatedMinutes)).toEqual([60, 60, 60]);
    expect(distributed.map((item) => item.quantity.amount)).toEqual([74, 73, 73]);
    expect(distributed.map((item) => item.quantity.ordinalRange)).toEqual([
      { start: 1, end: 74 },
      { start: 75, end: 147 },
      { start: 148, end: 220 },
    ]);
    expect(distributed.map((item) => item.label)).toEqual([
      '英単語 74語（1〜74語）',
      '英単語 73語（75〜147語）',
      '英単語 73語（148〜220語）',
    ]);
  });

  it('has no discontinuity at the historical 100-word boundary when total time is the same', () => {
    for (const amount of [99, 100, 101]) {
      const graph = vocabularyGraph({ amount, minutes: 60 });
      const { distributed } = distribute(graph);
      expect(distributed).toHaveLength(1);
      expect(distributed[0]).toMatchObject({
        estimatedMinutes: 60,
        quantity: { amount, unitCode: 'word' },
      });
    }
  });

  it('does not pretend one session-duration fact is the total time for the whole vocabulary scope', () => {
    const graph = vocabularyGraph({
      amount: 220,
      minutes: 30,
      effortKind: 'session_duration',
    });
    const compiled = compileGenericPlanningWorkItems(graph);

    expect(compiled.readiness).toBe('needs_resolution');
    expect(compiled.issues).toEqual([
      expect.objectContaining({
        code: 'missing_effort_estimate',
        workloadFactId: 'workload-vocabulary',
        blocking: true,
      }),
    ]);
    expect(compiled.items[0]?.estimatedMinutes).toBeNull();
  });
});
