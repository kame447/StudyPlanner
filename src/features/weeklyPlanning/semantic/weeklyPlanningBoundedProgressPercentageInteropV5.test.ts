import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import { projectWeeklyPlanningBoundedProgressV5 } from './weeklyPlanningBoundedProgressProjectionV5';

const source = {
  conversationId: 'conversation-percent-bounded-interop',
  turnId: 'turn-percent-progress',
  semanticLocalId: 'percent-progress',
  sourceText: '完成を100%とすると今は50%くらいです',
  origin: 'user' as const,
};

function workload(params: {
  id: string;
  role: WorkloadFactV5['quantityRole'];
  amount: number;
  semanticLocalId: string;
}): WorkloadFactV5 {
  return {
    id: params.id,
    taskId: 'task-1',
    componentId: null,
    quantityRole: params.role,
    amount: params.amount,
    unitCode: 'custom',
    unitLabel: '%',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: { ...source, semanticLocalId: params.semanticLocalId },
    createdRevision: 2,
  };
}

function graphWith(workloads: WorkloadFactV5[]): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...empty,
    revision: 2,
    workloads,
    factLifecycles: workloads.map((fact) => ({
      factId: fact.id,
      status: 'active' as const,
      createdRevision: fact.createdRevision,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

describe('Stable V5 bounded and percentage progress interop', () => {
  it('does not retire a derived percentage remainder just because 100 percent is represented as scope total', () => {
    const original = graphWith([]);
    original.revision = 1;
    const total = workload({
      id: 'total-100-percent',
      role: 'scope_total',
      amount: 100,
      semanticLocalId: 'total-percent',
    });
    const completed = workload({
      id: 'completed-50-percent',
      role: 'completed',
      amount: 50,
      semanticLocalId: 'completed-percent',
    });
    const remaining = workload({
      id: 'remaining-50-percent',
      role: 'remaining',
      amount: 50,
      semanticLocalId: 'completed-percent:derived-remaining-percent:remaining-50-percent',
    });
    const graph = graphWith([total, completed, remaining]);

    const result = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: original,
      canonicalization: {
        status: 'applied',
        graph,
        diff: {
          fromRevision: 1,
          toRevision: 2,
          added: [total, completed, remaining].map((fact) => ({
            kind: 'workload' as const,
            id: fact.id,
          })),
          superseded: [],
          removed: [],
        },
        errors: [],
        localToFactId: {},
      },
      operationKeyPrefix: 'turn-percent-progress',
    });

    const activeIds = new Set(
      result.graph.factLifecycles
        .filter((entry) => entry.status === 'active')
        .map((entry) => entry.factId),
    );
    expect(activeIds).toContain(remaining.id);
    expect(result.graph.workloads.filter((fact) => activeIds.has(fact.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quantityRole: 'scope_total', amount: 100, unitLabel: '%' }),
        expect.objectContaining({ quantityRole: 'completed', amount: 50, unitLabel: '%' }),
        expect.objectContaining({ quantityRole: 'remaining', amount: 50, unitLabel: '%' }),
      ]),
    );
  });
});
