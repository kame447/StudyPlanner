import { describe, expect, it } from 'vitest';
import type { TaskRelationFact } from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { orderGenericSchedulerWorkItemsByRelationsV5 } from './weeklyPlanningSchedulerWorkDistributionV5';

const source = {
  conversationId: 'conversation-relations',
  turnId: 'turn-1',
  semanticLocalId: 'relation',
  sourceText: 'relation',
  origin: 'user' as const,
};

function item(taskId: string, suffix = '1'): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: `${taskId}:${suffix}`,
    taskId,
    componentId: null,
    workloadFactId: `${taskId}:workload`,
    label: taskId,
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: 1,
      unitCode: 'session',
      unitLabel: '回',
      ordinalRange: { start: 1, end: 1 },
      actualRange: null,
    },
    estimatedMinutes: 60,
    estimateBasis: 'direct_effort',
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'atomic',
    periodExpression: null,
    sourceFactRefs: [taskId],
  };
}

function relation(
  kind: TaskRelationFact['kind'],
  fromTaskId: string,
  toTaskId: string,
): TaskRelationFact {
  return {
    id: `${kind}:${fromTaskId}:${toTaskId}`,
    kind,
    fromTaskId,
    toTaskId,
    source,
    createdRevision: 1,
  };
}

describe('Stable V5 relation-aware work ordering', () => {
  it.each([
    ['before', 'a', 'b', ['a', 'b']],
    ['sequence', 'a', 'b', ['a', 'b']],
    ['priority_over', 'a', 'b', ['a', 'b']],
    ['after', 'a', 'b', ['b', 'a']],
    ['depends_on', 'a', 'b', ['b', 'a']],
  ] as const)('applies %s deterministically', (kind, from, to, expected) => {
    const result = orderGenericSchedulerWorkItemsByRelationsV5({
      items: [item('b'), item('a')],
      relations: [relation(kind, from, to)],
    });
    expect(result.map((value) => value.taskId)).toEqual(expected);
  });

  it('keeps all slices of the same task contiguous while respecting task order', () => {
    const result = orderGenericSchedulerWorkItemsByRelationsV5({
      items: [item('b', '1'), item('a', '1'), item('b', '2'), item('a', '2')],
      relations: [relation('before', 'a', 'b')],
    });
    expect(result.map((value) => value.id)).toEqual([
      'a:1', 'a:2', 'b:1', 'b:2',
    ]);
  });

  it('preserves canonical input order when relations form a cycle instead of inventing a winner', () => {
    const input = [item('b'), item('a'), item('c')];
    const result = orderGenericSchedulerWorkItemsByRelationsV5({
      items: input,
      relations: [
        relation('before', 'a', 'b'),
        relation('before', 'b', 'a'),
      ],
    });
    expect(result).toEqual(input);
  });

  it('is stable across repeated invocations', () => {
    const input = [item('c'), item('b'), item('a')];
    const relations = [
      relation('depends_on', 'c', 'b'),
      relation('before', 'a', 'b'),
    ];
    const first = orderGenericSchedulerWorkItemsByRelationsV5({ items: input, relations });
    const second = orderGenericSchedulerWorkItemsByRelationsV5({ items: input, relations });
    expect(second).toEqual(first);
  });
});
