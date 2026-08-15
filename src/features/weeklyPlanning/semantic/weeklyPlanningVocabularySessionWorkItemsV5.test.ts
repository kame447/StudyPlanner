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

describe('vocabulary scheduling boundary', () => {
  it('preserves an explicitly supplied total duration without inventing word-count sessions', () => {
    const graph = vocabularyGraph({ amount: 220, minutes: 180 });
    const { compiled, distributed } = distribute(graph);

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
    expect(distributed).toHaveLength(1);
    expect(distributed[0]).toMatchObject({
      estimatedMinutes: 180,
      quantity: { amount: 220, unitCode: 'word' },
    });
  });

  it('has no special behavior at the historical 100-word boundary', () => {
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

  it('does not pretend one session-duration fact is total time for the vocabulary scope', () => {
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
