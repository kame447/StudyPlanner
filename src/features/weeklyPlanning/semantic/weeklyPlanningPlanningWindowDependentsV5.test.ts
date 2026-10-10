import { weeklyPlanningActiveFactReferencesV5 } from './weeklyPlanningActiveFactReferenceInvariantV5';
import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';

function windowsWithNeed(): WeeklyPlanningFactGraphV5 {
  const source = { conversationId: 'synthetic', turnId: 'one', semanticLocalId: 'window', sourceText: '明日', origin: 'user' as const };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    planningWindows: ['old', 'new'].map((id, index) => ({ id, kind: 'relative_day', value: index ? 'today' : 'tomorrow', start: null, end: null, source, createdRevision: 1 })),
    uncertainties: [{ id: 'need', targetFactId: 'old', field: 'opaque', reason: 'Unresolved window detail', source, createdRevision: 1 }],
    factLifecycles: ['old', 'new', 'need'].map(factId => ({ factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null })),
  };
}

describe('planning window dependent safety', () => {
  it('rejects removing a referenced window and retains original evidence', () => {
    const graph = windowsWithNeed();
    const before = JSON.stringify(graph);
    const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: 1, operation: { kind: 'remove', targetFactId: 'old', operationKey: 'remove' } });
    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(graph);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('rejects a replacement of another kind before changing dependents', () => {
    const graph = windowsWithNeed();
    graph.tasks.push({ id: 'other-kind', category: 'non_study', title: 'Synthetic event', source: graph.planningWindows[0].source, createdRevision: 1 });
    graph.factLifecycles.push({ factId: 'other-kind', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const before = JSON.stringify(graph);
    const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: 1, operation: { kind: 'supersede', targetFactId: 'old', replacementFactId: 'other-kind', operationKey: 'wrong-kind' } });
    expect(result.status).toBe('rejected');
    expect(JSON.stringify(graph)).toBe(before);
    expect(result.graph).toBe(graph);
  });

  it('detects an active uncertainty pointing to a superseded window', () => {
    const graph = windowsWithNeed();
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
    graph.revision = 2;
    graph.factLifecycles[0] = { ...graph.factLifecycles[0], status: 'superseded', terminalRevision: 2, supersededByFactId: 'new' };
    expect(weeklyPlanningActiveFactReferencesV5(graph)).toEqual([{ factId: 'need', targetFactId: 'old', path: 'graph.uncertainties[0].targetFactId' }]);
    // Existing sessions remain readable; the write invariant is not a codec gate.
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
  });

  it('allows historical uncertainty references to historical windows', () => {
    const graph = windowsWithNeed();
    graph.revision = 2;
    graph.factLifecycles[0] = { ...graph.factLifecycles[0], status: 'superseded', terminalRevision: 2, supersededByFactId: 'new' };
    graph.factLifecycles[2] = { ...graph.factLifecycles[2], status: 'removed', terminalRevision: 2 };
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
  });

  it('exempts correction and decision history that intentionally keeps the replaced target', () => {
    const graph = windowsWithNeed();
    const target = { kind: 'planning_window' as const, factId: 'old', publicId: 'old', mention: null };
    const source = graph.planningWindows[0].source;
    graph.correctionIntents.push({ id: 'correction', target, operation: 'replace', replacementFactId: 'new', source, createdRevision: 1 });
    graph.decisionIntents.push({ id: 'decision', target, decision: 'accept', source, createdRevision: 1 });
    graph.factLifecycles.push(...['correction', 'decision'].map(factId => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null })));
    const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision, operation: { kind: 'supersede', targetFactId: 'old', replacementFactId: 'new', operationKey: 'history' } });
    expect(result.status).toBe('applied');
    expect(result.graph.correctionIntents[0].target.factId).toBe('old');
    expect(result.graph.decisionIntents[0].target.factId).toBe('old');
    expect(weeklyPlanningActiveFactReferencesV5(result.graph)).toEqual([]);
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });
});

describe('explicit window replacement policy', () => {
  it.each([false, true])('keeps historical references and carries only identical-value questions (identical=%s)', identical => {
    const graph = windowsWithNeed();
    if (identical) graph.planningWindows[1].value = 'tomorrow';
    const original = JSON.stringify(graph);
    const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: 1,
      operation: { kind: 'supersede', targetFactId: 'old', replacementFactId: 'new', operationKey: 'replace' } });
    expect(result.status).toBe('applied');
    expect(JSON.stringify(graph)).toBe(original);
    expect(weeklyPlanningActiveFactReferencesV5(result.graph)).toEqual(identical
      ? [{ factId: 'need', targetFactId: 'new', path: 'graph.uncertainties[0].targetFactId' }] : []);
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
    expect(result.graph.uncertainties[0]).toEqual({ ...graph.uncertainties[0], targetFactId: identical ? 'new' : 'old' });
    expect(result.graph.factLifecycles.find(entry => entry.factId === 'need')?.status).toBe(identical ? 'active' : 'removed');
    expect(result.removed).toEqual(identical ? [] : [{ kind: 'uncertainty', id: 'need' }]);
    expect(applyWeeklyPlanningFactLifecycleOperationV5({ graph: result.graph, expectedRevision: result.graph.revision,
      operation: { kind: 'supersede', targetFactId: 'old', replacementFactId: 'new', operationKey: 'replace' } }).status).toBe('duplicate');
  });
});
