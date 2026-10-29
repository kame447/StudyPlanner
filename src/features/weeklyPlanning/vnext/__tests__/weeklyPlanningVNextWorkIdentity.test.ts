import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WorkloadFactV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import {
  computeVNextWorkUnits,
  vnextLineageIdByFactId,
  vnextQuantityBasisKey,
} from '../weeklyPlanningVNextWorkIdentity';
import type { WeeklyPlanningVNextGraph } from '../weeklyPlanningVNextTypes';

const source = (semanticLocalId: string) => ({
  conversationId: 'vnext-identity-fixture',
  turnId: 'turn-1',
  semanticLocalId,
  sourceText: 'offline fixture',
  origin: 'user' as const,
});

function workload(params: {
  id: string;
  role: WorkloadFactV5['quantityRole'];
  amount: number;
  unitCode?: WorkloadFactV5['unitCode'];
  unitLabel?: string;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  perOccurrence?: boolean;
  periodExpression?: string | null;
}): WorkloadFactV5 {
  return {
    id: params.id,
    taskId: 'task-slides',
    componentId: null,
    quantityRole: params.role,
    amount: params.amount,
    unitCode: params.unitCode ?? 'custom',
    unitLabel: params.unitLabel ?? '枚',
    rangeStart: params.rangeStart ?? null,
    rangeEnd: params.rangeEnd ?? null,
    perOccurrence: params.perOccurrence ?? false,
    periodExpression: params.periodExpression ?? null,
    source: source(params.id),
    createdRevision: 1,
  };
}

function graphWithWorkloads(workloads: WorkloadFactV5[]): WeeklyPlanningVNextGraph {
  const base = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...base,
    revision: 1,
    tasks: [{ id: 'task-slides', category: 'non_study', title: 'スライド', source: source('task-slides'), createdRevision: 1 }],
    workloads,
    effortEstimates: [],
    factLifecycles: workloads.map((fact) => ({
      factId: fact.id,
      status: 'active' as const,
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

describe('VNext work identity kernel', () => {
  it('derives remaining work from total and completed without storing a remainder', () => {
    const graph = graphWithWorkloads([
      workload({ id: 'total', role: 'scope_total', amount: 20 }),
      workload({ id: 'completed', role: 'completed', amount: 10 }),
    ]);

    const [owner] = computeVNextWorkUnits(graph);
    expect(owner.issue).toBeNull();
    expect(owner.units).toHaveLength(1);
    expect(owner.units[0]).toMatchObject({ workLineageId: 'total', amount: 10, derivedFromTotal: true });
  });

  it('keeps range and per-occurrence quantities on separate bases', () => {
    const base = workload({ id: 'range', role: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ', rangeStart: '1', rangeEnd: '10' });
    const occurrence = workload({ id: 'occurrence', role: 'target', amount: 5, unitCode: 'page', unitLabel: 'ページ', rangeStart: '1', rangeEnd: '10', perOccurrence: true, periodExpression: 'each_session' });
    const graph = graphWithWorkloads([base, occurrence]);

    expect(vnextQuantityBasisKey(base)).not.toBe(vnextQuantityBasisKey(occurrence));
    expect(computeVNextWorkUnits(graph)[0].units.map(({ amount, workload: fact }) => ({ amount, perOccurrence: fact.perOccurrence })))
      .toEqual([{ amount: 10, perOccurrence: false }, { amount: 5, perOccurrence: true }]);
  });

  it('keeps an explicit inconsistent remainder available for a question instead of rewriting it', () => {
    const graph = graphWithWorkloads([
      workload({ id: 'total', role: 'scope_total', amount: 20 }),
      workload({ id: 'completed', role: 'completed', amount: 12 }),
      workload({ id: 'stated-remaining', role: 'remaining', amount: 7 }),
    ]);

    const [owner] = computeVNextWorkUnits(graph);
    expect(owner.issue).toMatchObject({ code: 'remaining_inconsistent', statedAmount: 7, derivedAmount: 8 });
    expect(graph.workloads.find(({ id }) => id === 'stated-remaining')?.amount).toBe(7);
  });

  it('resolves the same lineage through replacement while a later new fact starts another lineage', () => {
    const graph = graphWithWorkloads([
      workload({ id: 'old-completed', role: 'completed', amount: 10 }),
      workload({ id: 'replacement-completed', role: 'completed', amount: 12 }),
      workload({ id: 'reintroduced-completed', role: 'completed', amount: 12 }),
    ]);
    graph.factLifecycles = [
      { factId: 'old-completed', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'replacement-completed' },
      { factId: 'replacement-completed', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
      { factId: 'reintroduced-completed', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null },
    ];

    const lineages = vnextLineageIdByFactId(graph);
    expect(lineages.get('replacement-completed')).toBe('old-completed');
    expect(lineages.get('reintroduced-completed')).toBe('reintroduced-completed');
  });
});
