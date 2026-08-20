import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import {
  projectWeeklyPlanningBoundedProgressV5,
} from './weeklyPlanningBoundedProgressProjectionV5';

const source = {
  conversationId: 'conversation-bounded-order',
  turnId: 'turn-bounded-order',
  semanticLocalId: 'bounded-order',
  sourceText: '全部で20枚です',
  origin: 'user' as const,
};

function workload(params: {
  id: string;
  role: WorkloadFactV5['quantityRole'];
  amount: number;
  createdRevision: number;
}): WorkloadFactV5 {
  return {
    id: params.id,
    taskId: 'task-1',
    componentId: null,
    quantityRole: params.role,
    amount: params.amount,
    unitCode: 'page',
    unitLabel: '枚',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: { ...source, semanticLocalId: params.id },
    createdRevision: params.createdRevision,
  };
}

function graphWith(params: {
  workloads: WorkloadFactV5[];
  revision: number;
}): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...empty,
    revision: params.revision,
    workloads: params.workloads,
    factLifecycles: params.workloads.map((fact) => ({
      factId: fact.id,
      status: 'active' as const,
      createdRevision: fact.createdRevision,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function activeWorkloads(graph: WeeklyPlanningFactGraphV5): WorkloadFactV5[] {
  const active = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  return graph.workloads.filter((fact) => active.has(fact.id));
}

describe('Stable V5 bounded progress projection order', () => {
  it('derives remaining when completed count is accepted before total scope', () => {
    const completed = workload({
      id: 'completed-12',
      role: 'completed',
      amount: 12,
      createdRevision: 2,
    });
    const original = graphWith({ workloads: [completed], revision: 2 });

    const total = workload({
      id: 'total-20',
      role: 'scope_total',
      amount: 20,
      createdRevision: 3,
    });
    const next = graphWith({ workloads: [completed, total], revision: 3 });

    const result = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: original,
      canonicalization: {
        status: 'applied',
        graph: next,
        diff: {
          fromRevision: original.revision,
          toRevision: next.revision,
          added: [{ kind: 'workload', id: total.id }],
          superseded: [],
          removed: [],
        },
        errors: [],
        localToFactId: {},
      },
      operationKeyPrefix: 'turn-total-after-completed',
    });

    expect(result.status).toBe('applied');
    expect(activeWorkloads(result.graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: completed.id, quantityRole: 'completed', amount: 12 }),
      expect.objectContaining({ id: total.id, quantityRole: 'scope_total', amount: 20 }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8, unitLabel: '枚' }),
    ]));
    expect(result.diff?.added).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workload' }),
    ]));
  });
});
