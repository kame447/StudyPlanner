import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { distributeGenericSchedulerWorkItemsV5 } from './weeklyPlanningSchedulerWorkDistributionV5';

const WEEK_START = '2026-08-17';
const WEEK_END = '2026-08-23';

function graphForDiscreteWork(params: {
  amount: number;
  unitCode: 'problem' | 'page';
  unitLabel: string;
  minutesPerUnit: number;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  const source = {
    conversationId: 'conversation-discrete-work',
    turnId: 'turn-1',
    semanticLocalId: 'discrete-work',
    sourceText: `数学${params.amount}${params.unitLabel}`,
    origin: 'user' as const,
  };
  return {
    ...graph,
    revision: 1,
    tasks: [{
      id: 'task-math',
      category: 'study',
      title: '数学',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-math',
      taskId: 'task-math',
      componentId: null,
      quantityRole: 'target',
      amount: params.amount,
      unitCode: params.unitCode,
      unitLabel: params.unitLabel,
      rangeStart: params.rangeStart ?? null,
      rangeEnd: params.rangeEnd ?? null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'estimate-math',
      taskId: 'task-math',
      targetFactId: 'workload-math',
      kind: 'duration_per_unit',
      minutes: params.minutesPerUnit,
      unitCode: params.unitCode,
      precision: 'approximate',
      source,
      createdRevision: 1,
    }],
  };
}

function compileAndDistribute(graph: WeeklyPlanningFactGraph) {
  const compiled = compileGenericPlanningWorkItems(graph);
  const distributed = distributeGenericSchedulerWorkItemsV5({
    graph,
    items: compiled.items,
    startDate: WEEK_START,
    endDate: WEEK_END,
  });
  return { compiled, distributed };
}

describe('quantity-preserving discrete work distribution', () => {
  it('keeps the compiler aggregate, then turns 40 problems into five scheduler work items', () => {
    const { compiled, distributed } = compileAndDistribute(graphForDiscreteWork({
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 8,
    }));

    expect(compiled.readiness).toBe('ready');
    expect(compiled.issues).toEqual([]);
    expect(compiled.items).toHaveLength(1);
    expect(compiled.items[0]).toMatchObject({
      quantity: { amount: 40, unitCode: 'problem' },
      baseEstimatedMinutes: 320,
      estimatedMinutes: 330,
    });

    expect(distributed.map((item) => item.quantity.amount)).toEqual([8, 8, 8, 8, 8]);
    expect(distributed.map((item) => item.estimatedMinutes)).toEqual([70, 65, 65, 65, 65]);
    expect(distributed.map((item) => item.label)).toEqual([
      '数学 8問（1〜8問）',
      '数学 8問（9〜16問）',
      '数学 8問（17〜24問）',
      '数学 8問（25〜32問）',
      '数学 8問（33〜40問）',
    ]);
    expect(distributed.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(40);
    expect(distributed.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(330);
    expect(distributed.every((item) => item.splitPolicy === 'atomic')).toBe(true);
    expect(new Set(distributed.map((item) => item.id)).size).toBe(5);
  });

  it('preserves an explicit numeric page range across scheduler slices', () => {
    const { distributed } = compileAndDistribute(graphForDiscreteWork({
      amount: 40,
      unitCode: 'page',
      unitLabel: 'ページ',
      minutesPerUnit: 4,
      rangeStart: '21',
      rangeEnd: '60',
    }));

    expect(distributed.map((item) => item.quantity.actualRange)).toEqual([
      { start: '21', end: '40' },
      { start: '41', end: '60' },
    ]);
    expect(distributed.map((item) => item.label)).toEqual([
      '数学 20ページ（21〜40ページ）',
      '数学 20ページ（41〜60ページ）',
    ]);
    expect(distributed.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(40);
    expect(distributed.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(165);
  });

  it('does not fake-split one extremely long discrete unit into repeated copies', () => {
    const { compiled, distributed } = compileAndDistribute(graphForDiscreteWork({
      amount: 1,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 320,
    }));

    expect(compiled.items).toHaveLength(1);
    expect(distributed).toHaveLength(1);
    expect(distributed[0]).toMatchObject({
      label: '数学 1問',
      estimatedMinutes: 330,
      quantity: {
        amount: 1,
        ordinalRange: { start: 1, end: 1 },
      },
    });
  });

  it('uses the actual horizon length instead of hard-coding a weekly split count', () => {
    const graph = graphForDiscreteWork({
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 8,
    });
    const compiled = compileGenericPlanningWorkItems(graph);
    const distributed = distributeGenericSchedulerWorkItemsV5({
      graph,
      items: compiled.items,
      startDate: '2026-08-17',
      endDate: '2026-08-18',
    });

    expect(distributed.map((item) => item.quantity.amount)).toEqual([20, 20]);
    expect(distributed.map((item) => item.estimatedMinutes)).toEqual([165, 165]);
    expect(distributed.map((item) => item.label)).toEqual([
      '数学 20問（1〜20問）',
      '数学 20問（21〜40問）',
    ]);
  });
});
