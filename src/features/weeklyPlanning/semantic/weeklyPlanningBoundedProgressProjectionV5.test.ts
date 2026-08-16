import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import {
  projectWeeklyPlanningBoundedProgressV5,
} from './weeklyPlanningBoundedProgressProjectionV5';

const source = {
  conversationId: 'conversation-bounded',
  turnId: 'turn-bounded',
  semanticLocalId: 'bounded',
  sourceText: '全部で20枚です',
  origin: 'user' as const,
};

function workload(params: {
  id: string;
  role: WorkloadFactV5['quantityRole'];
  amount: number;
  unitCode?: WorkloadFactV5['unitCode'];
  unitLabel?: string;
  createdRevision?: number;
  semanticLocalId?: string;
}): WorkloadFactV5 {
  return {
    id: params.id,
    taskId: 'task-1',
    componentId: null,
    quantityRole: params.role,
    amount: params.amount,
    unitCode: params.unitCode ?? 'page',
    unitLabel: params.unitLabel ?? '枚',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: { ...source, semanticLocalId: params.semanticLocalId ?? params.id },
    createdRevision: params.createdRevision ?? 2,
  };
}

function graphWith(params: {
  workloads: WorkloadFactV5[];
  efforts?: EffortEstimateFactV5[];
  revision?: number;
}): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  const efforts = params.efforts ?? [];
  return {
    ...empty,
    revision: params.revision ?? 2,
    workloads: params.workloads,
    effortEstimates: efforts,
    factLifecycles: [
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

function applied(
  original: WeeklyPlanningFactGraphV5,
  next: WeeklyPlanningFactGraphV5,
  added: Array<{ kind: 'workload' | 'effort_estimate'; id: string }>,
) {
  return {
    status: 'applied' as const,
    graph: next,
    diff: {
      fromRevision: original.revision,
      toRevision: next.revision,
      added,
      superseded: [],
      removed: [],
    },
    errors: [],
    localToFactId: {},
  };
}

function activeWorkloads(graph: WeeklyPlanningFactGraphV5) {
  const ids = new Set(graph.factLifecycles
    .filter((entry) => entry.status === 'active')
    .map((entry) => entry.factId));
  return graph.workloads.filter((fact) => ids.has(fact.id));
}

function activeEfforts(graph: WeeklyPlanningFactGraphV5) {
  const ids = new Set(graph.factLifecycles
    .filter((entry) => entry.status === 'active')
    .map((entry) => entry.factId));
  return graph.effortEstimates.filter((fact) => ids.has(fact.id));
}

describe('Stable V5 bounded progress projection', () => {
  it('keeps total scope non-schedulable and derives exact remaining from current completed count', () => {
    const original = graphWith({ workloads: [], revision: 1 });
    const total = workload({ id: 'total-20', role: 'scope_total', amount: 20, createdRevision: 2 });
    const completed = workload({ id: 'completed-12', role: 'completed', amount: 12, createdRevision: 2 });
    const next = graphWith({ workloads: [total, completed], revision: 2 });

    const result = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: original,
      canonicalization: applied(original, next, [
        { kind: 'workload', id: total.id },
        { kind: 'workload', id: completed.id },
      ]),
      operationKeyPrefix: 'turn-bounded',
    });

    expect(result.status).toBe('applied');
    expect(activeWorkloads(result.graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: total.id, quantityRole: 'scope_total', amount: 20 }),
      expect.objectContaining({ id: completed.id, quantityRole: 'completed', amount: 12 }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8, unitLabel: '枚' }),
    ]));
  });

  it('retires percentage remainder and its effort when a concrete total scope is later accepted', () => {
    const completedPercent = workload({
      id: 'completed-60-percent', role: 'completed', amount: 60,
      unitCode: 'custom', unitLabel: '%', createdRevision: 2,
    });
    const remainingPercent = workload({
      id: 'remaining-40-percent', role: 'remaining', amount: 40,
      unitCode: 'custom', unitLabel: '%', createdRevision: 3,
      semanticLocalId: 'percent:derived-remaining-percent:remaining-40-percent',
    });
    const percentEffort: EffortEstimateFactV5 = {
      id: 'effort-percent-120',
      taskId: 'task-1',
      targetFactId: remainingPercent.id,
      kind: 'total_duration',
      minutes: 120,
      unitCode: null,
      precision: 'approximate',
      source: { ...source, semanticLocalId: 'percent-effort' },
      createdRevision: 4,
    };
    const original = graphWith({
      workloads: [completedPercent, remainingPercent],
      efforts: [percentEffort],
      revision: 4,
    });
    const total = workload({ id: 'total-20', role: 'scope_total', amount: 20, createdRevision: 5 });
    const next = graphWith({
      workloads: [completedPercent, remainingPercent, total],
      efforts: [percentEffort],
      revision: 5,
    });

    const result = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: original,
      canonicalization: applied(original, next, [{ kind: 'workload', id: total.id }]),
      operationKeyPrefix: 'turn-total-after-percent',
    });

    expect(result.status).toBe('applied');
    const active = activeWorkloads(result.graph);
    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: completedPercent.id, quantityRole: 'completed', unitLabel: '%' }),
      expect.objectContaining({ id: total.id, quantityRole: 'scope_total', amount: 20 }),
    ]));
    expect(active).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: remainingPercent.id }),
    ]));
    expect(activeEfforts(result.graph)).toHaveLength(0);
  });

  it('replaces approximate percentage progress when an exact completed count arrives', () => {
    const total = workload({ id: 'total-20', role: 'scope_total', amount: 20, createdRevision: 3 });
    const completedPercent = workload({
      id: 'completed-60-percent', role: 'completed', amount: 60,
      unitCode: 'custom', unitLabel: '%', createdRevision: 2,
    });
    const original = graphWith({ workloads: [total, completedPercent], revision: 3 });
    const completedExact = workload({ id: 'completed-12', role: 'completed', amount: 12, createdRevision: 4 });
    const next = graphWith({ workloads: [total, completedPercent, completedExact], revision: 4 });

    const result = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: original,
      canonicalization: applied(original, next, [{ kind: 'workload', id: completedExact.id }]),
      operationKeyPrefix: 'turn-exact-progress',
    });

    const active = activeWorkloads(result.graph);
    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: completedExact.id, quantityRole: 'completed', amount: 12, unitLabel: '枚' }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8, unitLabel: '枚' }),
    ]));
    expect(active).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: completedPercent.id }),
    ]));
  });

  it('rejects completed progress that exceeds a fixed total scope', () => {
    const total = workload({ id: 'total-20', role: 'scope_total', amount: 20, createdRevision: 2 });
    const original = graphWith({ workloads: [total], revision: 2 });
    const completed = workload({ id: 'completed-21', role: 'completed', amount: 21, createdRevision: 3 });
    const next = graphWith({ workloads: [total, completed], revision: 3 });

    const result = projectWeeklyPlanningBoundedProgressV5({
      originalGraph: original,
      canonicalization: applied(original, next, [{ kind: 'workload', id: completed.id }]),
      operationKeyPrefix: 'turn-invalid-progress',
    });

    expect(result.status).toBe('rejected');
    expect(result.errors[0]).toContain('bounded-progress-completed-exceeds-total');
    expect(result.graph).toEqual(original);
  });
});
