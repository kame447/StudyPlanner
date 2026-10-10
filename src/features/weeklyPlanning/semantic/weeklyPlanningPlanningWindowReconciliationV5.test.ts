import { describe, expect, it } from 'vitest';
import { reconcileWeeklyPlanningHistoricalWindowQuestionsV5 } from './weeklyPlanningPlanningWindowReconciliationV5';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from './weeklyPlanningSemanticCanonicalizerV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { eventDocument, fixedEventTask } from '../testUtils/__tests__/weeklyPlanningCorrectionIntegrityFixture';

function fixture(): WeeklyPlanningFactGraphV5 {
  const source = { conversationId: 'recovery', turnId: 'one', semanticLocalId: 'old', sourceText: 'synthetic', origin: 'user' as const };
  return { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2,
    planningWindows: ['old', 'new'].map((id, index) => ({ id, kind: 'relative_day', value: index ? 'today' : 'tomorrow', start: null, end: null, source, createdRevision: 1 })),
    uncertainties: [{ id: 'need', targetFactId: 'old', field: 'opaque', reason: 'Unresolved period', source, createdRevision: 1 }],
    factLifecycles: [
      { factId: 'old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'new' },
      ...['new', 'need'].map(factId => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null })),
    ],
  };
}
function result(graph: WeeklyPlanningFactGraphV5): WeeklyPlanningSemanticCanonicalizationResultV5 {
  return { status: 'applied', graph, diff: { fromRevision: graph.revision, toRevision: graph.revision, added: [], superseded: [], removed: [] }, errors: [], localToFactId: {} };
}

describe('write-only historical window reconciliation', () => {
  it.each(['changed', 'identical', 'cross_kind', 'named_period'] as const)('uses D1 on already-dangling %s questions, even without a new fact', shape => {
    const graph = fixture();
    if (shape === 'identical') graph.planningWindows[1].value = 'tomorrow';
    if (shape === 'cross_kind') graph.planningWindows[1] = { ...graph.planningWindows[1], kind: 'absolute', value: '2026-10-08/2026-10-08', start: '2026-10-08', end: '2026-10-08' };
    if (shape === 'named_period') graph.planningWindows.forEach((window, index) => { window.kind = 'named_period'; window.value = index ? '10月半ば' : '10月中旬'; });
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
    const before = JSON.stringify(graph);
    const repaired = reconcileWeeklyPlanningHistoricalWindowQuestionsV5({ originalGraph: graph, canonicalization: result(graph) });
    expect(repaired.status).toBe('applied');
    expect(JSON.stringify(graph)).toBe(before);
    expect(repaired.graph.revision).toBe(3);
    expect(validateWeeklyPlanningFactGraphValueV5(repaired.graph).errors).toEqual([]);
    expect(repaired.graph.uncertainties[0]).toEqual({ ...graph.uncertainties[0], targetFactId: shape === 'changed' ? 'old' : 'new' });
    expect(repaired.graph.factLifecycles.find(entry => entry.factId === 'need')?.status).toBe(shape === 'changed' ? 'removed' : 'active');
    expect(repaired.diff?.removed).toEqual(shape === 'changed' ? [{ kind: 'uncertainty', id: 'need' }] : []);
    expect(reconcileWeeklyPlanningHistoricalWindowQuestionsV5({ originalGraph: repaired.graph, canonicalization: repaired })).toBe(repaired);
  });

  it('rejects a historical supersession cycle atomically instead of hiding its question', () => {
    const graph = fixture();
    graph.planningWindows[1].value = 'tomorrow';
    graph.factLifecycles[1] = { ...graph.factLifecycles[1], status: 'superseded', terminalRevision: 2, supersededByFactId: 'old' };
    const before = JSON.stringify(graph);
    const repaired = reconcileWeeklyPlanningHistoricalWindowQuestionsV5({ originalGraph: graph, canonicalization: result(graph) });
    expect(repaired.status).toBe('rejected');
    expect(repaired.errors).toEqual(['window-reconciliation-cycle:old']);
    expect(repaired.graph).toBe(graph);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('reconciles questions from converging historical replacement chains without a false cycle', () => {
    const graph = fixture();
    graph.revision = 3;
    graph.planningWindows[1].value = 'tomorrow';
    graph.planningWindows.push({ ...graph.planningWindows[0], id: 'other-old' }, { ...graph.planningWindows[1], id: 'current' });
    graph.uncertainties.push({ ...graph.uncertainties[0], id: 'other-need', targetFactId: 'other-old' });
    graph.factLifecycles[1] = { ...graph.factLifecycles[1], status: 'superseded', terminalRevision: 3, supersededByFactId: 'current' };
    graph.factLifecycles.push(
      { factId: 'other-old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'new' },
      ...['current', 'other-need'].map(factId => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null })),
    );
    const repaired = reconcileWeeklyPlanningHistoricalWindowQuestionsV5({ originalGraph: graph, canonicalization: result(graph) });
    expect(repaired.status).toBe('applied');
    expect(repaired.graph.uncertainties.map(need => ({ id: need.id, target: need.targetFactId }))).toEqual([
      { id: 'need', target: 'current' }, { id: 'other-need', target: 'current' },
    ]);
    expect(validateWeeklyPlanningFactGraphValueV5(repaired.graph).errors).toEqual([]);
  });

  it('retains the invalidation on an intermediate changed date even when the final date returns to the original', () => {
    const graph = fixture();
    graph.revision = 3;
    graph.planningWindows.push({ ...graph.planningWindows[0], id: 'current' });
    graph.factLifecycles[1] = { ...graph.factLifecycles[1], status: 'superseded', terminalRevision: 3, supersededByFactId: 'current' };
    graph.factLifecycles.push({ factId: 'current', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const repaired = reconcileWeeklyPlanningHistoricalWindowQuestionsV5({ originalGraph: graph, canonicalization: result(graph) });
    expect(repaired.status).toBe('applied');
    expect(repaired.graph.factLifecycles.find(entry => entry.factId === 'need')?.status).toBe('removed');
    expect(repaired.diff?.removed).toEqual([{ kind: 'uncertainty', id: 'need' }]);
    expect(validateWeeklyPlanningFactGraphValueV5(repaired.graph).errors).toEqual([]);
  });

  it('the provider schema does not admit a window as an operational commitment target', () => {
    const task = fixedEventTask();
    task.temporalConstraints[0].targetLocalId = 'window';
    const validation = validateWeeklyPlanningSemanticValueV5(eventDocument({ planningWindow: { localId: 'window', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日' }, tasks: [task] }));
    expect(validation.document).toBeNull();
    expect(validation.errors.some(error => error.includes('targetLocalId'))).toBe(true);
  });
});

it('the public pipeline rolls back an unrepairable historical window after staging an unrelated valid write', async () => {
  const { createWeeklyPlanningSemanticPipelineV5 } = await import('./weeklyPlanningSemanticPipelineV5');
  const graph = fixture();
  graph.factLifecycles[0] = { ...graph.factLifecycles[0], status: 'removed', supersededByFactId: null };
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
  const before = JSON.stringify(graph);
  const document = eventDocument({ tasks: [fixedEventTask()] }) as unknown as import('./weeklyPlanningSemanticDocumentV5').WeeklyPlanningSemanticDocumentV5;
  const pipeline = createWeeklyPlanningSemanticPipelineV5({ normalize: async () => ({ status: 'accepted', document,
    diagnostics: { schemaVersion: 'weekly-planning-semantic-v5', jsonSchemaName: 'weekly_planning_semantic_document_v5',
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
      requestBytes: [1], responseLengths: [1], latencyMs: 1, validationErrors: [], providerError: null } }) });
  const result = await pipeline.run({ graph, conversationId: 'recovery', turnId: 'unrelated', expectedRevision: graph.revision,
    userText: 'synthetic', recentConversation: [], publicStateSummary: {}, schedulerContext: {
      ownerId: 'owner', currentDate: '2026-10-10', planningStartDate: '2026-10-10', planningEndDate: '2026-10-16', timeZone: 'UTC',
    } });
  expect(result.status).toBe('canonicalization_rejected');
  expect(result.graph).toBe(graph);
  expect(result.canonicalization?.graph).toBe(graph);
  expect(result.canonicalization?.diff).toBeNull();
  expect(result.canonicalization?.errors).toContain('window-reconciliation-replacement-required:old');
  expect(JSON.stringify(graph)).toBe(before);
});
