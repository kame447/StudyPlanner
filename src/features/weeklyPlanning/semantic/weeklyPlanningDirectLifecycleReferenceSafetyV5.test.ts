import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { weeklyPlanningIntroducedActiveFactReferenceErrorsV5 } from './weeklyPlanningActiveFactReferenceInvariantV5';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';
import { applyWeeklyPlanningCorrectionTransactionV5 } from './weeklyPlanningCorrectionTransactionV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { workloadLifecycleFixture } from '../testUtils/__tests__/weeklyPlanningWorkloadLifecycleFixture';
import { eventDocument } from '../testUtils/__tests__/weeklyPlanningCorrectionIntegrityFixture';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { applyWeeklyPlanningExistingEntityBindingsV5 } from './weeklyPlanningExistingEntityBindingApplicationV5';
import { projectWeeklyPlanningBoundedProgressV5 } from './weeklyPlanningBoundedProgressProjectionV5';
import { projectWeeklyPlanningPercentageProgressV5 } from './weeklyPlanningPercentageProgressProjectionV5';
import { eventStudyTask } from '../testUtils/__tests__/weeklyPlanningCorrectionIntegrityFixture';
import { reconcileWeeklyPlanningProgressCorrectionsV5 } from './weeklyPlanningProgressCorrectionReconciliationV5';
import { applyWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';

describe('direct Fact Graph lifecycle editors do not introduce inactive operational references', () => {
  it('the generic lifecycle engine rejects replacing referenced work without a policy', () => {
    const graph = workloadLifecycleFixture({ correction: true });
    const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision,
      operation: { operationKey: 'generic', kind: 'supersede', targetFactId: 'work', replacementFactId: 'replacement' } });
    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(graph);
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: result.graph })).toEqual([]);
  });

  it('the correction transaction migrates dependents and consumes only operation history', () => {
    const graph = workloadLifecycleFixture({ correction: true });
    const result = applyWeeklyPlanningCorrectionTransactionV5({ graph, expectedRevision: graph.revision, correctionIntentFactId: 'correction', operationKey: 'correction-sweep' });
    expect(result.status).toBe('applied');
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: result.graph })).toEqual([]);
    expect(result.graph.correctionIntents[0].target.factId).toBe('work');
  });

  it('the implicit window editor retires its changed-window dependent in the same result', () => {
    const context = { conversationId: 'sweep', turnId: 'one', expectedRevision: 0 };
    const first = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: eventDocument({ planningWindow: { localId: 'old', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日' },
        uncertainties: [{ localId: 'need', targetLocalId: 'old', field: 'opaque', reason: 'synthetic', sourceText: '明日' }] }) as unknown as WeeklyPlanningSemanticDocumentV5, context });
    expect(first.status).toBe('applied');
    const next = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: first.graph,
      document: eventDocument({ planningWindow: { localId: 'new', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日' } }) as unknown as WeeklyPlanningSemanticDocumentV5,
      context: { ...context, turnId: 'two', expectedRevision: first.graph.revision } });
    expect(next.status).toBe('applied');
    expect(next.diff?.removed).toContainEqual({ kind: 'uncertainty', id: first.graph.uncertainties[0].id });
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: first.graph, graph: next.graph })).toEqual([]);
  });

  it('existing-entity binding removes transient lifecycle entries only after rebinding their operational references', () => {
    const graph = workloadLifecycleFixture();
    const task = eventStudyTask('problem');
    const document = eventDocument({ tasks: [{ ...task, existingPublicId: 'task', title: 'synthetic',
      workloads: [{ ...task.workloads[0], quantityRole: 'unknown' }],
      effortEstimates: [{ localId: 'current-pace', targetLocalId: 'study-amount', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', sourceText: 'synthetic' }] }] }) as unknown as WeeklyPlanningSemanticDocumentV5;
    const staged = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document,
      context: { conversationId: 'lifecycle-synthetic', turnId: 'binding', expectedRevision: graph.revision } });
    expect(staged.status).toBe('applied');
    const bound = applyWeeklyPlanningExistingEntityBindingsV5({ originalGraph: graph, document, canonicalization: staged });
    expect(bound.status).toBe('applied');
    expect(bound.canonicalization.localToFactId.study).toBe('task');
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: bound.canonicalization.graph })).toEqual([]);
  });

  it.each(['bounded', 'percentage'] as const)('new %s progress lifecycle entries retain active owners', kind => {
    const graph = workloadLifecycleFixture();
    graph.effortEstimates = [];
    graph.factLifecycles = graph.factLifecycles.filter(entry => entry.factId !== 'pace');
    graph.workloads[0].quantityRole = 'scope_total';
    const completed = { ...graph.workloads[0], id: 'completed', quantityRole: 'completed' as const, amount: kind === 'bounded' ? 5 : 25,
      ...(kind === 'percentage' ? { unitCode: 'custom' as const, unitLabel: '%' } : {}) };
    graph.workloads.push(completed);
    graph.factLifecycles.push({ factId: 'completed', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const canonicalization = { status: 'applied' as const, graph, diff: { fromRevision: 0, toRevision: 1,
      added: graph.workloads.map(fact => ({ kind: 'workload' as const, id: fact.id })), superseded: [], removed: [] }, errors: [], localToFactId: {} };
    const result = (kind === 'bounded' ? projectWeeklyPlanningBoundedProgressV5 : projectWeeklyPlanningPercentageProgressV5)({
      originalGraph: createEmptyWeeklyPlanningFactGraphV5(), canonicalization, operationKeyPrefix: `sweep-${kind}` });
    expect(result.status).toBe('applied');
    expect(result.graph.workloads.length).toBeGreaterThan(graph.workloads.length);
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: result.graph })).toEqual([]);
  });

  it('progress correction creates replacement lifecycle entries with active owners', () => {
    const graph = workloadLifecycleFixture();
    graph.effortEstimates = [];
    graph.factLifecycles = graph.factLifecycles.filter(entry => entry.factId !== 'pace');
    graph.workloads[0] = { ...graph.workloads[0], quantityRole: 'completed', amount: 10 };
    graph.workloads.push({ ...graph.workloads[0], id: 'remaining', quantityRole: 'remaining', amount: 10 });
    graph.factLifecycles.push({ factId: 'remaining', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const updated = structuredClone(graph);
    updated.revision = 3;
    updated.workloads.push({ ...graph.workloads[0], id: 'new-completed', amount: 12, createdRevision: 2 });
    updated.factLifecycles[1] = { ...updated.factLifecycles[1], status: 'superseded', terminalRevision: 3, supersededByFactId: 'new-completed' };
    updated.factLifecycles.push({ factId: 'new-completed', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null });
    const result = reconcileWeeklyPlanningProgressCorrectionsV5({ originalGraph: graph,
      canonicalization: { status: 'applied', graph: updated, diff: { fromRevision: 1, toRevision: 3, added: [{ kind: 'workload', id: 'new-completed' }], superseded: [{ kind: 'workload', id: 'work' }], removed: [] }, errors: [], localToFactId: {} },
      operationKeyPrefix: 'progress-sweep' });
    expect(result.status).toBe('applied');
    expect(result.graph.workloads.length).toBeGreaterThan(updated.workloads.length);
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: result.graph })).toEqual([]);
  });

  it('contextual effort entry creation binds only the active machine-selected workload and owner', () => {
    const graph = workloadLifecycleFixture();
    graph.workloads[0].quantityRole = 'target';
    graph.effortEstimates = [];
    graph.factLifecycles = graph.factLifecycles.filter(entry => entry.factId !== 'pace');
    const task = eventStudyTask('problem');
    const document = eventDocument({ tasks: [{ ...task, existingPublicId: 'task', title: 'synthetic', workloads: [],
      effortEstimates: [{ localId: 'answer-pace', targetLocalId: 'study', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', sourceText: 'typed' }] }] }) as unknown as WeeklyPlanningSemanticDocumentV5;
    const result = applyWeeklyPlanningStableV5ContextualAnswer({ graph, document,
      pendingQuestion: { actionId: null, questionCode: 'missing_effort_estimate', targetFactId: 'work', graphRevision: graph.revision, effortMeasurement: 'duration_per_unit' },
      conversationId: 'lifecycle-synthetic', turnId: 'effort-answer', expectedRevision: graph.revision, userText: 'typed' });
    expect(result?.status).toBe('applied');
    expect(result!.graph.effortEstimates[0]).toMatchObject({ targetFactId: 'work', taskId: 'task' });
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: result!.graph })).toEqual([]);
  });

  it('contextual uncertainty cleanup retires only the exact question after creating owner-bound facts', () => {
    const graph = workloadLifecycleFixture();
    graph.uncertainties.push({ id: 'breakdown', targetFactId: 'task', field: 'work_breakdown', reason: 'synthetic', source: graph.tasks[0].source, createdRevision: 1 });
    graph.factLifecycles.push({ factId: 'breakdown', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const task = eventStudyTask('problem');
    const document = eventDocument({ tasks: [{ ...task, existingPublicId: 'task', title: 'synthetic', decompositionStatus: 'decomposed', workloads: [], study: { ...task.study,
      components: [{ localId: 'material', existingPublicId: null, parentLocalId: null, role: 'material', label: 'material', workloads: [], sourceText: 'material' }] } }] }) as unknown as WeeklyPlanningSemanticDocumentV5;
    const result = applyWeeklyPlanningStableV5ContextualAnswer({ graph, document,
      pendingQuestion: { actionId: null, questionCode: 'semantic_uncertainty', targetFactId: 'breakdown', graphRevision: graph.revision },
      conversationId: 'lifecycle-synthetic', turnId: 'uncertainty-answer', expectedRevision: graph.revision, userText: 'typed' });
    expect(result?.status).toBe('applied');
    expect(result!.graph.factLifecycles.find(entry => entry.factId === 'breakdown')?.status).toBe('removed');
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: result!.graph })).toEqual([]);
  });
});
