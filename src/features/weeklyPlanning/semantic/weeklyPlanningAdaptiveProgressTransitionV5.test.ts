import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  projectWeeklyPlanningPercentageProgressV5,
} from './weeklyPlanningPercentageProgressProjectionV5';
import {
  projectWeeklyPlanningBoundedProgressV5,
} from './weeklyPlanningBoundedProgressProjectionV5';
import {
  compileGenericPlanningWorkItems,
} from './weeklyPlanningGenericWorkItems';

const source = {
  conversationId: 'adaptive-progress-transition',
  turnId: 'turn-progress',
  semanticLocalId: 'progress',
  sourceText: '完成を100%とすると60%くらいです',
  origin: 'user' as const,
};

function workload(params: {
  id: string;
  role: WorkloadFactV5['quantityRole'];
  amount: number;
  unitCode: WorkloadFactV5['unitCode'];
  unitLabel: string;
  revision: number;
  semanticLocalId?: string;
}): WorkloadFactV5 {
  return {
    id: params.id,
    taskId: 'task-slides',
    componentId: null,
    quantityRole: params.role,
    amount: params.amount,
    unitCode: params.unitCode,
    unitLabel: params.unitLabel,
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: {
      ...source,
      semanticLocalId: params.semanticLocalId ?? params.id,
    },
    createdRevision: params.revision,
  };
}

function graph(params: {
  revision: number;
  workloads: WorkloadFactV5[];
  efforts?: EffortEstimateFactV5[];
}): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  const efforts = params.efforts ?? [];
  return {
    ...empty,
    revision: params.revision,
    tasks: [{
      id: 'task-slides',
      category: 'study',
      title: '夏合宿の発表スライド',
      source,
      createdRevision: 1,
    }],
    workloads: params.workloads,
    effortEstimates: efforts,
    factLifecycles: [
      {
        factId: 'task-slides',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      ...params.workloads.map((fact) => ({
        factId: fact.id,
        status: 'active' as const,
        createdRevision: fact.createdRevision,
        terminalRevision: null,
        supersededByFactId: null,
      })),
      ...efforts.map((fact) => ({
        factId: fact.id,
        status: 'active' as const,
        createdRevision: fact.createdRevision,
        terminalRevision: null,
        supersededByFactId: null,
      })),
    ],
  };
}

function applied(params: {
  original: WeeklyPlanningFactGraphV5;
  next: WeeklyPlanningFactGraphV5;
  added: Array<{ kind: 'workload' | 'effort_estimate'; id: string }>;
}) {
  return {
    status: 'applied' as const,
    graph: params.next,
    diff: {
      fromRevision: params.original.revision,
      toRevision: params.next.revision,
      added: params.added,
      superseded: [],
      removed: [],
    },
    errors: [],
    localToFactId: {},
  };
}

function activeIds(value: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(value.factLifecycles
    .filter((entry) => entry.status === 'active')
    .map((entry) => entry.factId));
}

function activeWorkloads(value: WeeklyPlanningFactGraphV5) {
  const ids = activeIds(value);
  return value.workloads.filter((fact) => ids.has(fact.id));
}

function activeEfforts(value: WeeklyPlanningFactGraphV5) {
  const ids = activeIds(value);
  return value.effortEstimates.filter((fact) => ids.has(fact.id));
}

function compileActive(value: WeeklyPlanningFactGraphV5) {
  return compileGenericPlanningWorkItems(
    createWeeklyPlanningActiveSchedulerGraphViewV5(value),
  );
}

describe('Stable V5 adaptive progress representation transition', () => {
  it('moves from percentage progress to exact fixed-total progress without double scheduling', () => {
    const initial = graph({ revision: 1, workloads: [] });
    const completed60 = workload({
      id: 'completed-60-percent',
      role: 'completed',
      amount: 60,
      unitCode: 'custom',
      unitLabel: '%',
      revision: 2,
    });
    const afterSemanticPercent = graph({ revision: 2, workloads: [completed60] });
    const percentage = projectWeeklyPlanningPercentageProgressV5({
      originalGraph: initial,
      canonicalization: applied({
        original: initial,
        next: afterSemanticPercent,
        added: [{ kind: 'workload', id: completed60.id }],
      }),
      operationKeyPrefix: 'turn-percent',
    });
    expect(percentage.status).toBe('applied');
    const percentRemaining = activeWorkloads(percentage.graph).find((fact) =>
      fact.quantityRole === 'remaining' && fact.unitLabel === '%');
    expect(percentRemaining).toMatchObject({ amount: 40 });

    const percentEffort: EffortEstimateFactV5 = {
      id: 'percent-effort-120',
      taskId: 'task-slides',
      targetFactId: percentRemaining!.id,
      kind: 'total_duration',
      minutes: 120,
      unitCode: null,
      precision: 'approximate',
      source: {
        ...source,
        turnId: 'turn-percent-effort',
        semanticLocalId: 'percent-effort',
        sourceText: '残りは2時間くらいです',
      },
      createdRevision: percentage.graph.revision + 1,
    };
    const withPercentEffort: WeeklyPlanningFactGraphV5 = {
      ...percentage.graph,
      revision: percentage.graph.revision + 1,
      effortEstimates: [...percentage.graph.effortEstimates, percentEffort],
      factLifecycles: [
        ...percentage.graph.factLifecycles,
        {
          factId: percentEffort.id,
          status: 'active',
          createdRevision: percentage.graph.revision + 1,
          terminalRevision: null,
          supersededByFactId: null,
        },
      ],
    };
    expect(compileActive(withPercentEffort)).toMatchObject({
      readiness: 'ready',
      items: [expect.objectContaining({ workloadFactId: percentRemaining!.id })],
    });

    const total20 = workload({
      id: 'scope-total-20',
      role: 'scope_total',
      amount: 20,
      unitCode: 'page',
      unitLabel: '枚',
      revision: withPercentEffort.revision + 1,
    });
    const afterTotalSemantic: WeeklyPlanningFactGraphV5 = {
      ...withPercentEffort,
      revision: withPercentEffort.revision + 1,
      workloads: [...withPercentEffort.workloads, total20],
      factLifecycles: [
        ...withPercentEffort.factLifecycles,
        {
          factId: total20.id,
          status: 'active',
          createdRevision: withPercentEffort.revision + 1,
          terminalRevision: null,
          supersededByFactId: null,
        },
      ],
    };
    const afterTotal = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: withPercentEffort,
      canonicalization: applied({
        original: withPercentEffort,
        next: afterTotalSemantic,
        added: [{ kind: 'workload', id: total20.id }],
      }),
      operationKeyPrefix: 'turn-total',
    });
    expect(afterTotal.status).toBe('applied');
    expect(activeWorkloads(afterTotal.graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: total20.id, quantityRole: 'scope_total', amount: 20 }),
      expect.objectContaining({ id: completed60.id, quantityRole: 'completed', unitLabel: '%' }),
    ]));
    expect(activeWorkloads(afterTotal.graph)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: percentRemaining!.id }),
    ]));
    expect(activeEfforts(afterTotal.graph)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: percentEffort.id }),
    ]));
    expect(compileActive(afterTotal.graph).items).toHaveLength(0);

    const completed12 = workload({
      id: 'completed-12-exact',
      role: 'completed',
      amount: 12,
      unitCode: 'page',
      unitLabel: '枚',
      revision: afterTotal.graph.revision + 1,
    });
    const afterExactSemantic: WeeklyPlanningFactGraphV5 = {
      ...afterTotal.graph,
      revision: afterTotal.graph.revision + 1,
      workloads: [...afterTotal.graph.workloads, completed12],
      factLifecycles: [
        ...afterTotal.graph.factLifecycles,
        {
          factId: completed12.id,
          status: 'active',
          createdRevision: afterTotal.graph.revision + 1,
          terminalRevision: null,
          supersededByFactId: null,
        },
      ],
    };
    const afterExact = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: afterTotal.graph,
      canonicalization: applied({
        original: afterTotal.graph,
        next: afterExactSemantic,
        added: [{ kind: 'workload', id: completed12.id }],
      }),
      operationKeyPrefix: 'turn-exact',
    });
    expect(afterExact.status).toBe('applied');
    const finalActive = activeWorkloads(afterExact.graph);
    expect(finalActive).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: total20.id, quantityRole: 'scope_total', amount: 20 }),
      expect.objectContaining({ id: completed12.id, quantityRole: 'completed', amount: 12 }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8, unitLabel: '枚' }),
    ]));
    expect(finalActive).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: completed60.id }),
      expect.objectContaining({ quantityRole: 'remaining', unitLabel: '%' }),
    ]));
    expect(activeEfforts(afterExact.graph)).toHaveLength(0);
    const compilation = compileActive(afterExact.graph);
    expect(compilation.readiness).toBe('needs_resolution');
    expect(compilation.items).toHaveLength(1);
    expect(compilation.items[0]).toMatchObject({
      quantityRole: 'remaining',
      quantity: { amount: 8, unitLabel: '枚' },
    });
    expect(compilation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing_effort_estimate',
        workloadFactId: compilation.items[0].workloadFactId,
        blocking: true,
      }),
    ]));
  });
});
