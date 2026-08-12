import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';

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

describe('quantity-preserving discrete work distribution', () => {
  it('turns 40 problems at eight minutes each into five daily work items without duplicating quantity', () => {
    const result = compileGenericPlanningWorkItems(graphForDiscreteWork({
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 8,
    }));

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.quantity.amount)).toEqual([8, 8, 8, 8, 8]);
    expect(result.items.map((item) => item.estimatedMinutes)).toEqual([70, 65, 65, 65, 65]);
    expect(result.items.map((item) => item.label)).toEqual([
      '数学 8問（1〜8問）',
      '数学 8問（9〜16問）',
      '数学 8問（17〜24問）',
      '数学 8問（25〜32問）',
      '数学 8問（33〜40問）',
    ]);
    expect(result.items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(40);
    expect(result.items.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(330);
    expect(result.items.every((item) => item.splitPolicy === 'atomic')).toBe(true);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(5);
  });

  it('preserves an explicit numeric page range across distributed sessions', () => {
    const result = compileGenericPlanningWorkItems(graphForDiscreteWork({
      amount: 40,
      unitCode: 'page',
      unitLabel: 'ページ',
      minutesPerUnit: 4,
      rangeStart: '21',
      rangeEnd: '60',
    }));

    expect(result.items.map((item) => item.quantity.actualRange)).toEqual([
      { start: '21', end: '40' },
      { start: '41', end: '60' },
    ]);
    expect(result.items.map((item) => item.label)).toEqual([
      '数学 20ページ（21〜40ページ）',
      '数学 20ページ（41〜60ページ）',
    ]);
    expect(result.items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(40);
  });

  it('does not fake-split one extremely long discrete unit into repeated copies', () => {
    const result = compileGenericPlanningWorkItems(graphForDiscreteWork({
      amount: 1,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 320,
    }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      label: '数学 1問',
      estimatedMinutes: 330,
      splitPolicy: 'atomic',
      quantity: {
        amount: 1,
        ordinalRange: { start: 1, end: 1 },
      },
    });
  });
});
