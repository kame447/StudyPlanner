import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';

function vocabularyGraph(amount: number): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  const source = {
    conversationId: 'conversation-vocabulary',
    turnId: 'turn-1',
    semanticLocalId: 'vocabulary',
    sourceText: `英単語${amount}語`,
    origin: 'user' as const,
  };
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
      amount,
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
      id: 'estimate-vocabulary-session',
      taskId: 'task-vocabulary',
      targetFactId: 'workload-vocabulary',
      kind: 'session_duration',
      minutes: 30,
      unitCode: 'word',
      precision: 'approximate',
      source,
      createdRevision: 1,
    }],
  };
}

describe('vocabulary learning session work-item expansion', () => {
  it.each([
    [150, [75, 75]],
    [160, [80, 80]],
    [180, [90, 90]],
    [220, [70, 70, 80]],
    [299, [99, 100, 100]],
  ])('expands %i words into independent scheduler work items', (amount, quantities) => {
    const result = compileGenericPlanningWorkItems(vocabularyGraph(amount));

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.quantity.amount)).toEqual(quantities);
    expect(result.items.map((item) => item.estimatedMinutes)).toEqual(
      quantities.map(() => 30),
    );
    expect(result.items.every((item) => item.splitPolicy === 'atomic')).toBe(true);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(quantities.length);
    expect(result.items.map((item) => item.label)).toEqual(
      quantities.map((quantity, index) =>
        `英単語 ${quantity}語（${index + 1}/${quantities.length}）`),
    );
  });

  it('preserves cumulative ordinal ranges across the expanded sessions', () => {
    const result = compileGenericPlanningWorkItems(vocabularyGraph(220));

    expect(result.items.map((item) => item.quantity.ordinalRange)).toEqual([
      { start: 1, end: 70 },
      { start: 71, end: 140 },
      { start: 141, end: 220 },
    ]);
    expect(result.items.every((item) =>
      item.estimateSourceFactIds.includes('estimate-vocabulary-session'))).toBe(true);
  });
});
