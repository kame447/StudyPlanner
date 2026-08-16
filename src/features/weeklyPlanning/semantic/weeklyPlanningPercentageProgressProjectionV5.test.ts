import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import {
  projectWeeklyPlanningPercentageProgressV5,
} from './weeklyPlanningPercentageProgressProjectionV5';

const source = {
  conversationId: 'conversation-1',
  turnId: 'turn-progress',
  semanticLocalId: 'progress',
  sourceText: '完成を100%とすると60%くらいです',
  origin: 'user' as const,
};

function workload(params: {
  id: string;
  role: WorkloadFactV5['quantityRole'];
  amount: number;
  unitCode?: WorkloadFactV5['unitCode'];
  unitLabel?: string;
  createdRevision?: number;
}): WorkloadFactV5 {
  return {
    id: params.id,
    taskId: 'task-1',
    componentId: null,
    quantityRole: params.role,
    amount: params.amount,
    unitCode: params.unitCode ?? 'custom',
    unitLabel: params.unitLabel ?? '%',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source,
    createdRevision: params.createdRevision ?? 2,
  };
}

function graphWith(workloads: WorkloadFactV5[], revision = 2): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...empty,
    revision,
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

function applied(original: WeeklyPlanningFactGraphV5, next: WeeklyPlanningFactGraphV5, addedIds: string[]) {
  return {
    status: 'applied' as const,
    graph: next,
    diff: {
      fromRevision: original.revision,
      toRevision: next.revision,
      added: addedIds.map((id) => ({ kind: 'workload' as const, id })),
      superseded: [],
      removed: [],
    },
    errors: [],
    localToFactId: {},
  };
}

function activeWorkloads(graph: WeeklyPlanningFactGraphV5): WorkloadFactV5[] {
  const activeIds = new Set(
    graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId),
  );
  return graph.workloads.filter((fact) => activeIds.has(fact.id));
}

describe('Stable V5 percentage progress projection', () => {
  it('derives remaining percentage without estimating duration from completed pace', () => {
    const original = graphWith([], 1);
    const completed = workload({ id: 'completed-60', role: 'completed', amount: 60, createdRevision: 2 });
    const canonical = applied(original, graphWith([completed], 2), [completed.id]);

    const result = projectWeeklyPlanningPercentageProgressV5({
      originalGraph: original,
      canonicalization: canonical,
      operationKeyPrefix: 'turn-progress',
    });

    expect(result.status).toBe('applied');
    expect(activeWorkloads(result.graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 60, unitCode: 'custom', unitLabel: '%' }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 40, unitCode: 'custom', unitLabel: '%' }),
    ]));
    expect(result.graph.effortEstimates).toHaveLength(0);
  });

  it('does not manufacture percentage remaining when bounded schedulable work already exists', () => {
    const target = workload({
      id: 'target-40', role: 'target', amount: 40, unitCode: 'problem', unitLabel: '問', createdRevision: 1,
    });
    const original = graphWith([target], 1);
    const completed = workload({ id: 'completed-60', role: 'completed', amount: 60, createdRevision: 2 });
    const next = graphWith([target, completed], 2);
    const canonical = applied(original, next, [completed.id]);

    const result = projectWeeklyPlanningPercentageProgressV5({
      originalGraph: original,
      canonicalization: canonical,
      operationKeyPrefix: 'turn-progress-bounded',
    });

    expect(activeWorkloads(result.graph).filter((fact) =>
      fact.quantityRole === 'remaining' && fact.unitLabel === '%')).toHaveLength(0);
    expect(activeWorkloads(result.graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'target-40', quantityRole: 'target', amount: 40, unitLabel: '問' }),
    ]));
  });

  it('supersedes the old progress snapshot and rebases its derived remainder', () => {
    const completed60 = workload({ id: 'completed-60', role: 'completed', amount: 60, createdRevision: 2 });
    const remaining40 = workload({ id: 'remaining-40', role: 'remaining', amount: 40, createdRevision: 3 });
    const original = graphWith([completed60, remaining40], 3);
    const completed70 = workload({ id: 'completed-70', role: 'completed', amount: 70, createdRevision: 4 });
    const next = graphWith([completed60, remaining40, completed70], 4);
    const canonical = applied(original, next, [completed70.id]);

    const result = projectWeeklyPlanningPercentageProgressV5({
      originalGraph: original,
      canonicalization: canonical,
      operationKeyPrefix: 'turn-progress-update',
    });

    const active = activeWorkloads(result.graph);
    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'completed-70', quantityRole: 'completed', amount: 70, unitLabel: '%' }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 30, unitLabel: '%' }),
    ]));
    expect(active).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'completed-60' }),
      expect.objectContaining({ id: 'remaining-40' }),
    ]));
    expect(result.diff?.superseded).toEqual(expect.arrayContaining([
      { kind: 'workload', id: 'completed-60' },
      { kind: 'workload', id: 'remaining-40' },
    ]));
  });

  it('rejects two competing current percentage snapshots for one scope in the same semantic turn', () => {
    const original = graphWith([], 1);
    const completed60 = workload({ id: 'completed-60', role: 'completed', amount: 60, createdRevision: 2 });
    const completed70 = workload({ id: 'completed-70', role: 'completed', amount: 70, createdRevision: 2 });
    const canonical = applied(
      original,
      graphWith([completed60, completed70], 2),
      [completed60.id, completed70.id],
    );

    const result = projectWeeklyPlanningPercentageProgressV5({
      originalGraph: original,
      canonicalization: canonical,
      operationKeyPrefix: 'turn-progress-ambiguous',
    });

    expect(result.status).toBe('rejected');
    expect(result.errors).toEqual([
      'percentage-progress-ambiguous-current-snapshot:task-1|',
    ]);
    expect(result.graph).toEqual(original);
  });
});
