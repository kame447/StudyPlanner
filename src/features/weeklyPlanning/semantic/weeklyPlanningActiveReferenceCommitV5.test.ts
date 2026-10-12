import { describe, expect, it } from 'vitest';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import { workloadLifecycleFixture } from '../testUtils/__tests__/weeklyPlanningWorkloadLifecycleFixture';
import { eventDocument } from '../testUtils/__tests__/weeklyPlanningCorrectionIntegrityFixture';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

function inheritedReferenceGraph() {
  const graph = workloadLifecycleFixture({ correction: true });
  graph.factLifecycles.find(entry => entry.factId === 'work')!.status = 'superseded';
  graph.factLifecycles.find(entry => entry.factId === 'work')!.terminalRevision = 2;
  graph.factLifecycles.find(entry => entry.factId === 'work')!.supersededByFactId = 'replacement';
  graph.correctionIntents = [];
  graph.factLifecycles = graph.factLifecycles.filter(entry => entry.factId !== 'correction');
  return graph;
}
function stagedWrite(original: WeeklyPlanningFactGraphV5) {
  const graph = structuredClone(original);
  graph.revision += 1;
  graph.tasks.push({ ...graph.tasks[0], id: 'unrelated-task', createdRevision: graph.revision });
  graph.factLifecycles.push({ factId: 'unrelated-task', status: 'active', createdRevision: graph.revision, terminalRevision: null, supersededByFactId: null });
  return graph;
}
function commit(originalGraph: WeeklyPlanningFactGraphV5, graph: WeeklyPlanningFactGraphV5, contextualAnswer = false) {
  return finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph,
    document: eventDocument() as unknown as WeeklyPlanningSemanticDocumentV5,
    baseCanonicalization: { status: 'applied', graph, errors: [], localToFactId: {}, diff: {
      fromRevision: originalGraph.revision, toRevision: graph.revision, added: [{ kind: 'task', id: 'unrelated-task' }], removed: [], superseded: [],
    } }, contextualAnswer, questionCode: contextualAnswer ? 'quantity_role_unresolved' : null, operationKeyPrefix: 'commit-reference' }).canonicalization;
}

describe('the final semantic commit rejects only introduced inactive operational edges', () => {
  it.each([false, true])('rejects a new source edge with atomic rollback (contextual=%s)', contextual => {
    const original = inheritedReferenceGraph();
    const before = JSON.stringify(original);
    const graph = stagedWrite(original);
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'new-bad', createdRevision: graph.revision });
    graph.factLifecycles.push({ factId: 'new-bad', status: 'active', createdRevision: graph.revision, terminalRevision: null, supersededByFactId: null });
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
    const result = commit(original, graph, contextual);
    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(original);
    expect(result.diff).toBeNull();
    expect(result.errors).toContain('active-reference-invariant:graph.effortEstimates[1].targetFactId:target-not-active:work');
    expect(JSON.stringify(original)).toBe(before);
  });

  it.each(['target', 'property', 'reactivation'] as const)('detects introduced edge identity through changed %s', change => {
    const original = inheritedReferenceGraph();
    original.workloads.push({ ...original.workloads[0], id: 'another-inactive' });
    original.factLifecycles.push({ factId: 'another-inactive', status: 'removed', createdRevision: 1, terminalRevision: 2, supersededByFactId: null });
    if (change === 'reactivation') Object.assign(original.factLifecycles.find(entry => entry.factId === 'pace')!, { status: 'removed', terminalRevision: 2 });
    if (change === 'property') {
      original.tasks.push({ ...original.tasks[0], id: 'inactive-task' });
      original.factLifecycles.push({ factId: 'inactive-task', status: 'removed', createdRevision: 1, terminalRevision: 2, supersededByFactId: null });
      original.workloads[0].taskId = 'inactive-task';
      original.effortEstimates[0].taskId = 'inactive-task';
    }
    expect(validateWeeklyPlanningFactGraphValueV5(original).errors).toEqual([]);
    const graph = stagedWrite(original);
    if (change === 'target') graph.effortEstimates[0].targetFactId = 'another-inactive';
    if (change === 'property') graph.effortEstimates[0].targetFactId = 'inactive-task';
    if (change === 'reactivation') Object.assign(graph.factLifecycles.find(entry => entry.factId === 'pace')!, { status: 'active', terminalRevision: null });
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
    const result = commit(original, graph);
    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(original);
    expect(result.diff).toBeNull();
    expect(result.errors.some(error => error.startsWith('active-reference-invariant:'))).toBe(true);
  });

  it('keeps an exact inherited edge readable and permits an unrelated write after array insertion', () => {
    const original = inheritedReferenceGraph();
    const graph = stagedWrite(original);
    graph.effortEstimates.unshift({ ...graph.effortEstimates[0], id: 'safe', targetFactId: 'replacement', createdRevision: graph.revision });
    graph.factLifecycles.push({ factId: 'safe', status: 'active', createdRevision: graph.revision, terminalRevision: null, supersededByFactId: null });
    expect(validateWeeklyPlanningFactGraphValueV5(original).errors).toEqual([]);
    const result = commit(original, graph);
    expect(result.status).toBe('applied');
    expect(result.graph.effortEstimates[1]).toEqual(original.effortEstimates[0]);
    expect(result.errors).toEqual([]);
  });

  it('rejects an inactive target introduced by a later stage while retaining correction history', () => {
    const original = workloadLifecycleFixture({ correction: true });
    const graph = stagedWrite(original);
    graph.factLifecycles.find(entry => entry.factId === 'work')!.status = 'superseded';
    graph.factLifecycles.find(entry => entry.factId === 'work')!.terminalRevision = graph.revision;
    graph.factLifecycles.find(entry => entry.factId === 'work')!.supersededByFactId = 'replacement';
    const rejected = commit(original, graph);
    expect(rejected.status).toBe('rejected');
    graph.effortEstimates[0].targetFactId = 'replacement';
    expect(commit(original, graph).status).toBe('applied');
    expect(graph.correctionIntents[0].target.factId).toBe('work');
  });
});
