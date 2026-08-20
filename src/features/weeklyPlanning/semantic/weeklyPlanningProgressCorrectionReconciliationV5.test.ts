import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  reconcileWeeklyPlanningProgressCorrectionsV5,
} from './weeklyPlanningProgressCorrectionReconciliationV5';

const source = {
  conversationId: 'conversation-1',
  turnId: 'turn-2',
  semanticLocalId: 'workload',
  sourceText: '明日残りを終わらせたいです',
  origin: 'user' as const,
};

function originalGraph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 2,
    workloads: [
      {
        id: 'completed-10', taskId: 'task-1', componentId: null,
        quantityRole: 'completed', amount: 10, unitCode: 'custom', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source: { ...source, semanticLocalId: 'completed', sourceText: '今10枚までできています' }, createdRevision: 2,
      },
      {
        id: 'remaining-10', taskId: 'task-1', componentId: null,
        quantityRole: 'remaining', amount: 10, unitCode: 'custom', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source, createdRevision: 2,
      },
      {
        id: 'target-10', taskId: 'task-1', componentId: null,
        quantityRole: 'target', amount: 10, unitCode: 'custom', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: 'tomorrow',
        source, createdRevision: 2,
      },
    ],
    factLifecycles: ['completed-10', 'remaining-10', 'target-10'].map((factId) => ({
      factId,
      status: 'active' as const,
      createdRevision: 2,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function correctedCanonicalization() {
  const original = originalGraph();
  const replacement = {
    ...original.workloads[0],
    id: 'completed-12',
    amount: 12,
    source: {
      ...original.workloads[0].source,
      turnId: 'turn-3',
      semanticLocalId: 'completed-12',
      sourceText: '今は12枚までできています',
    },
    createdRevision: 3,
  };
  return {
    status: 'applied' as const,
    graph: {
      ...original,
      revision: 4,
      workloads: [...original.workloads, replacement],
      factLifecycles: [
        ...original.factLifecycles.map((entry) => entry.factId === 'completed-10'
          ? { ...entry, status: 'superseded' as const, terminalRevision: 4, supersededByFactId: 'completed-12' }
          : entry),
        {
          factId: 'completed-12', status: 'active' as const, createdRevision: 3,
          terminalRevision: null, supersededByFactId: null,
        },
      ],
    },
    diff: {
      fromRevision: 2,
      toRevision: 4,
      added: [{ kind: 'workload' as const, id: 'completed-12' }],
      superseded: [{ kind: 'workload' as const, id: 'completed-10' }],
      removed: [],
    },
    errors: [],
    localToFactId: {},
  };
}

function activeWorkloads(graph: WeeklyPlanningFactGraphV5) {
  const activeIds = new Set(graph.factLifecycles
    .filter((entry) => entry.status === 'active')
    .map((entry) => entry.factId));
  return graph.workloads.filter((fact) => activeIds.has(fact.id));
}

describe('Stable V5 progress correction reconciliation', () => {
  it('recomputes remaining work and a target derived from the same semantic clause', () => {
    const original = originalGraph();
    const result = reconcileWeeklyPlanningProgressCorrectionsV5({
      originalGraph: original,
      canonicalization: correctedCanonicalization(),
      operationKeyPrefix: 'turn-3',
    });
    expect(result.status).toBe('applied');
    const active = activeWorkloads(result.graph);
    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 12 }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8 }),
      expect.objectContaining({ quantityRole: 'target', amount: 8, periodExpression: 'tomorrow' }),
    ]));
    expect(active).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'remaining', amount: 10 }),
      expect.objectContaining({ quantityRole: 'target', amount: 10 }),
    ]));
  });

  it('retires a duplicate stale remaining fact even when the model gave it temporal wording', () => {
    const original = originalGraph();
    const duplicateRemaining = {
      ...original.workloads[1],
      id: 'remaining-10-tomorrow',
      periodExpression: 'tomorrow',
      source: {
        ...source,
        semanticLocalId: 'explicit-remaining',
        sourceText: '残りを終わらせたい',
      },
    };
    original.workloads.push(duplicateRemaining);
    original.factLifecycles.push({
      factId: duplicateRemaining.id,
      status: 'active',
      createdRevision: 2,
      terminalRevision: null,
      supersededByFactId: null,
    });

    const canonical = correctedCanonicalization();
    canonical.graph.workloads.splice(3, 0, duplicateRemaining);
    canonical.graph.factLifecycles.splice(3, 0, {
      factId: duplicateRemaining.id,
      status: 'active',
      createdRevision: 2,
      terminalRevision: null,
      supersededByFactId: null,
    });

    const result = reconcileWeeklyPlanningProgressCorrectionsV5({
      originalGraph: original,
      canonicalization: canonical,
      operationKeyPrefix: 'turn-3-duplicate-remaining',
    });

    expect(result.status).toBe('applied');
    const active = activeWorkloads(result.graph);
    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 12 }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8 }),
    ]));
    expect(active).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'remaining', amount: 10 }),
    ]));
  });

  it('does not rebase an independently sourced target that only happens to have the same amount', () => {
    const original = originalGraph();
    original.workloads[2] = {
      ...original.workloads[2],
      source: { ...source, turnId: 'turn-other', sourceText: '明日は10枚やりたい' },
    };
    const canonical = correctedCanonicalization();
    canonical.graph.workloads = [
      canonical.graph.workloads[0],
      canonical.graph.workloads[1],
      original.workloads[2],
      canonical.graph.workloads[3],
    ];
    const result = reconcileWeeklyPlanningProgressCorrectionsV5({
      originalGraph: original,
      canonicalization: canonical,
      operationKeyPrefix: 'turn-3-independent',
    });
    expect(result.status).toBe('applied');
    const activeIds = new Set(result.graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId));
    expect(result.graph.workloads.find((fact) => fact.id === 'target-10' && activeIds.has(fact.id)))
      .toEqual(expect.objectContaining({ amount: 10 }));
  });
});
