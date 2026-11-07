import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WorkloadFactV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import {
  computeVNextWorkUnits,
  vnextLineageIdByFactId,
  vnextQuantityBasisKey,
  resolveVNextEffortBinding,
} from '../weeklyPlanningVNextWorkIdentity';
import type { WeeklyPlanningVNextGraph } from '../weeklyPlanningVNextTypes';
import { compileGenericPlanningWorkItems } from '../../semantic/weeklyPlanningGenericWorkItems';

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
    studyContexts: [],
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
  it.each([
    { totalUnit: 'hour', total: 1, doneUnit: 'minute', done: 30, remaining: 0.5 },
    { totalUnit: 'minute', total: 60, doneUnit: 'hour', done: 0.5, remaining: 30 },
  ] as const)('derives mixed time progress without changing facts or binding units ($totalUnit)', ({ totalUnit, total, doneUnit, done, remaining }) => {
    const totalFact = workload({ id: 'total', role: 'scope_total', amount: total, unitCode: totalUnit });
    const graph = graphWithWorkloads([totalFact,
      workload({ id: 'done', role: 'completed', amount: done, unitCode: doneUnit })]);
    const before = structuredClone(graph);
    const [owner] = computeVNextWorkUnits(graph);
    expect(owner.issue).toBeNull();
    expect(owner.units).toHaveLength(1);
    expect(owner.units[0]).toMatchObject({ amount: remaining, workload: totalFact,
      basisKey: vnextQuantityBasisKey(totalFact), derivedFromTotal: true });
    expect(resolveVNextEffortBinding(graph, { workloadFactId: 'total' })).toEqual({
      kind: 'future_work', workLineageId: 'total', boundAmount: remaining, boundBasisKey: vnextQuantityBasisKey(totalFact),
    });
    expect(graph).toEqual(before);
  });

  it('keeps a weekly total separate from a per-session time quantity', () => {
    const total = workload({ id: 'total', role: 'scope_total', amount: 1, unitCode: 'hour' });
    const each = workload({ id: 'each', role: 'remaining', amount: 30, unitCode: 'minute', perOccurrence: true, periodExpression: 'each_session' });
    expect(computeVNextWorkUnits(graphWithWorkloads([total, each]))[0].units).toMatchObject([
      { amount: 1, workload: total, basisKey: vnextQuantityBasisKey(total) },
      { amount: 30, workload: each, basisKey: vnextQuantityBasisKey(each) },
    ]);
  });

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

/**
 * Real-API finding (run 41328196858): "合計60分かかります。今週の夜にやりたいです" was read as one `declared`
 * minute amount, and the role question was asked twice although its two offered answers (the plan's target amount,
 * the remaining total) schedule the same 60 minutes. The question stays only where its answers differ.
 */
describe('an unresolved declared quantity', () => {
  const minutes = (id: string, role: WorkloadFactV5['quantityRole'], amount: number) =>
    workload({ id, role, amount, unitCode: 'minute', unitLabel: '分' });
  const unitsOf = (...facts: WorkloadFactV5[]) => computeVNextWorkUnits(graphWithWorkloads(facts))[0];

  it('is not asked when both offered answers schedule the same work (the exact real-API reading)', () => {
    const owner = unitsOf(minutes('declared', 'declared', 60));
    expect(owner.issue).toBeNull();
    expect(owner.units).toMatchObject([{ workLineageId: 'declared', definingFactId: 'declared', amount: 60 }]);
  });

  it('is not asked when the other stated quantities agree with either answer', () => {
    // 100 in all, 40 done: the remaining reading derives 60, the target reading is 60.
    const owner = unitsOf(minutes('declared', 'declared', 60), minutes('total', 'scope_total', 100), minutes('done', 'completed', 40));
    expect(owner.issue).toBeNull();
    expect(owner.units.map(unit => unit.amount)).toEqual([60]);
  });

  it.each([
    ['a stated remaining of another amount', [minutes('declared', 'declared', 8), minutes('left', 'remaining', 5)]],
    ['progress that contradicts the remaining reading', [minutes('declared', 'declared', 50), minutes('total', 'scope_total', 100), minutes('done', 'completed', 40)]],
    ['a second declared amount of another size', [minutes('declared', 'declared', 30), { ...minutes('other', 'declared', 45) }]],
  ])('is still asked when %s makes the answers differ', (_name, facts) => {
    const owner = unitsOf(...facts);
    expect(owner.issue).toMatchObject({ code: 'quantity_role_unresolved' });
    expect(owner.units).toEqual([]);
  });

  it('keeps asking for an unknown role: its admissible answers include completed work', () => {
    expect(unitsOf(minutes('unknown', 'unknown', 60)).issue).toMatchObject({ code: 'quantity_role_unresolved' });
  });

  it('keeps the stated fact as it was said and resolves a later answer by an ordinary role patch', () => {
    const graph = graphWithWorkloads([minutes('declared', 'declared', 60)]);
    computeVNextWorkUnits(graph);
    expect(graph.workloads[0].quantityRole).toBe('declared');
  });

  // Stable V5 has no equal-outcome rule: it blocks every declared amount (its own tests keep that). VNext's rule
  // is the question's own contract, so on the differing case both cores agree.
  it('agrees with Stable V5 where the answers differ, and differs only where asking changes nothing', () => {
    const differing = graphWithWorkloads([minutes('declared', 'declared', 8), minutes('left', 'remaining', 5)]);
    const lone = graphWithWorkloads([minutes('declared', 'declared', 60)]);
    const blocked = (graph: WeeklyPlanningVNextGraph) => compileGenericPlanningWorkItems(graph).issues
      .some(issue => issue.code === 'quantity_role_unresolved' && issue.blocking);
    expect(blocked(differing)).toBe(true);
    expect(computeVNextWorkUnits(differing)[0].issue).toMatchObject({ code: 'quantity_role_unresolved' });
    expect(blocked(lone)).toBe(true);
    expect(computeVNextWorkUnits(lone)[0].issue).toBeNull();
  });
});

describe('lineage resolution', () => {
  type Entry = WeeklyPlanningVNextGraph['factLifecycles'][number];
  const version = (factId: string, status: Entry['status'], supersededByFactId: string | null = null): Entry =>
    ({ factId, status, createdRevision: 1, terminalRevision: status === 'active' ? null : 2, supersededByFactId });
  /** The walk from each version to the first one, as it was before roots were reused: the meaning oracle. */
  function walkEachVersion(factLifecycles: Entry[]): Map<string, string> {
    const predecessor = new Map(factLifecycles.filter((e) => e.status === 'superseded' && e.supersededByFactId)
      .map((e) => [e.supersededByFactId!, e.factId]));
    return new Map(factLifecycles.map((entry) => {
      let root = entry.factId;
      const seen = new Set([root]);
      while (predecessor.has(root)) {
        root = predecessor.get(root)!;
        if (seen.has(root)) break;
        seen.add(root);
      }
      return [entry.factId, root];
    }));
  }
  const chain = (prefix: string, n: number) => Array.from({ length: n }, (_, i) =>
    version(`${prefix}${i}`, i < n - 1 ? 'superseded' : 'active', i < n - 1 ? `${prefix}${i + 1}` : null));

  it.each([
    ['one chain, oldest first', chain('a', 6)],
    ['one chain, newest first', chain('a', 6).reverse()],
    ['two interleaved chains', chain('a', 4).flatMap((e, i) => [e, chain('b', 4)[i]])],
    // Removed then re-added with equal values: a new fact, a new lineage.
    ['remove and re-add', [version('w1', 'superseded', 'w2'), version('w2', 'removed'), version('w3', 'active')]],
    // Malformed data: the walk stops at the first repeated version instead of looping.
    ['two-version cycle', [version('x', 'superseded', 'y'), version('y', 'superseded', 'x')]],
    ['a tail into a cycle', [version('t', 'superseded', 'c1'), version('c1', 'superseded', 'c2'), version('c2', 'superseded', 'c1')]],
  ])('has the same meaning as walking from each version: %s', (_name, factLifecycles) => {
    expect(vnextLineageIdByFactId({ factLifecycles })).toEqual(walkEachVersion(factLifecycles));
  });

  it('resolves a long correction history with linear work, in either order', () => {
    // Map reads, not wall-clock time: a bound that does not depend on the machine.
    const reads = (factLifecycles: Entry[]) => {
      const get = Map.prototype.get;
      let count = 0;
      Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) { count += 1; return get.call(this, key); };
      try {
        const lineage = vnextLineageIdByFactId({ factLifecycles });
        return { count, lineage };
      } finally { Map.prototype.get = get; }
    };
    for (const versions of [chain('v', 1000), chain('v', 1000).reverse()]) {
      const { count, lineage } = reads(versions);
      expect(lineage.get('v999')).toBe('v0');
      expect(count).toBeLessThanOrEqual(6 * versions.length);
    }
  });
});
