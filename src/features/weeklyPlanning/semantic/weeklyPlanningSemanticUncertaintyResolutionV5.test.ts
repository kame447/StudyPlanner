import { validateWeeklyPlanningCurrentTurnProvenanceV5 } from './weeklyPlanningCurrentTurnProvenanceV5';
import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { applyWeeklyPlanningStableV5ContextualAnswer, evaluateWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import { hasWeeklyPlanningSemanticUncertaintyResolutionV5 } from './weeklyPlanningSemanticUncertaintyResolutionV5';

const source = { conversationId: 'c', turnId: 'first', semanticLocalId: 't', sourceText: 'work', origin: 'user' as const };
function graph(field = 'work_breakdown'): WeeklyPlanningFactGraphV5 {
  return { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    tasks: ['t', 'other'].map(id => ({ id, category: 'study' as const, title: id, source, createdRevision: 1 })),
    components: [{ id: 'existing-material', taskId: 't', parentComponentId: null, role: 'material', label: 'work', source, createdRevision: 1 }],
    uncertainties: ['t', 'other'].map(targetFactId => ({ id: `u-${targetFactId}`, targetFactId, field, reason: 'unknown', source, createdRevision: 1 })),
    factLifecycles: ['t', 'other', 'existing-material', 'u-t', 'u-other'].map(factId => ({ factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null })),
  };
}
function document(target = 't', existingComponent = false): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [{ localId: 'local', existingPublicId: target, decompositionStatus: 'decomposed', category: 'study', title: target,
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [{ localId: 'material', existingPublicId: existingComponent ? 'existing-material' : null, parentLocalId: null, role: 'material', label: 'work', workloads: [], durableContextSignals: [], sourceText: 'work' }] },
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: 'work' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
}
function input(state: WeeklyPlanningFactGraphV5, delta: WeeklyPlanningSemanticDocumentV5) {
  return { graph: state, document: delta, pendingQuestion: { actionId: 'q', questionCode: 'semantic_uncertainty', targetFactId: 'u-t', graphRevision: 1 }, conversationId: 'c', turnId: 'answer', expectedRevision: 1, userText: 'work' };
}
function commit(state: WeeklyPlanningFactGraphV5, delta: WeeklyPlanningSemanticDocumentV5) {
  const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: state, document: delta, context: { conversationId: 'c', turnId: 'answer', expectedRevision: 1 } });
  const result = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: state, document: delta, baseCanonicalization: base, contextualAnswer: false, questionCode: 'semantic_uncertainty', operationKeyPrefix: 'c:answer' }).canonicalization;
  expect(result.status, JSON.stringify(result.errors)).toBe('applied');
  return result;
}
function expectActive(state: WeeklyPlanningFactGraphV5, id = 'u-t') {
  expect(state.factLifecycles).toContainEqual(expect.objectContaining({ factId: id, status: 'active' }));
}

describe('exact-target dimension evidence is shared by contextual and normal commit cleanup', () => {
  it('does not resolve the pending task with a new material for a sibling', () => {
    const state = graph('material_identity'); const delta = document('other');
    expect(evaluateWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toMatchObject({ status: 'incompatible', reason: 'uncertainty_not_resolved' });
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
    const result = commit(state, delta);
    expectActive(result.graph);
    expect(result.graph.components).toContainEqual(expect.objectContaining({ taskId: 'other', role: 'material' }));
  });
  it('resolves only the exact material target when new material is actually supplied', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer(input(graph('material_identity'), document()))!;
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-t', status: 'removed' }));
    expectActive(result.graph, 'u-other');
  });
  it.each(['work_breakdown', 'material_identity', 'material'])('does not retire %s for a replayed component in normal commit', field => {
    const state = graph(field); const delta = document('t', true);
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
    expectActive(commit(state, delta).graph);
  });
  it.each(['total_duration', 'duration_per_unit', 'session_duration'] as const)('keeps material need open while admitting a %s detail', kind => {
    const state = graph('material_identity'); const delta = document();
    delta.tasks[0].decompositionStatus = 'atomic'; delta.tasks[0].study!.components = [];
    delta.tasks[0].effortEstimates = [{ localId: 'e', targetLocalId: 'local', kind, minutes: 3, unitCode: kind === 'duration_per_unit' ? 'problem' : null, precision: 'approximate', sourceText: 'work' }];
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
    const result = commit(state, delta);
    expectActive(result.graph); expect(result.graph.effortEstimates).toContainEqual(expect.objectContaining({ kind, minutes: 3, targetFactId: 't' }));
  });
  it('retains an explicitly repeated requirement even with new exact-target structure', () => {
    const state = graph('material_identity'); const delta = document();
    delta.uncertainties = [{ localId: 'still-unknown', targetLocalId: 'local', field: 'material_identity', reason: 'unknown', sourceText: 'work' }];
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
    expectActive(commit(state, delta).graph);
  });
  it('keeps an existing need when the same dimension remains unresolved at document scope', () => {
    const state = graph('material_identity'); const delta = document();
    delta.uncertainties = [{ localId: 'still-unknown', targetLocalId: 'document', field: 'material_identity', reason: 'unknown', sourceText: 'work' }];
    expect(hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph: state, document: delta, uncertainty: state.uncertainties[0] })).toBe(false);
    // This also protects non-pending needs: normal commit must not override
    // a document-level unresolved declaration merely because structure arrived.
    expectActive(commit(state, delta).graph);
  });
  it('retains the current stated-task-time-budget alternative for a work breakdown only', () => {
    const delta = document(); delta.tasks[0].study!.components = []; delta.tasks[0].decompositionStatus = 'atomic';
    delta.tasks[0].effortEstimates = [{ localId: 'e', targetLocalId: 'local', kind: 'total_duration', minutes: 120, unitCode: null, precision: 'exact', sourceText: 'work' }];
    const state = graph();
    expect(hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph: state, document: delta, uncertainty: state.uncertainties[0] })).toBe(true);
    const materialState = graph('material_identity');
    expect(hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph: materialState, document: delta, uncertainty: materialState.uncertainties[0] })).toBe(false);
  });
  it('does not use a sibling estimate or another measurement to resolve an effort need', () => {
    const state = graph('duration_per_unit');
    const delta = document('other'); delta.tasks[0].study!.components = [];
    delta.tasks[0].effortEstimates = [{ localId: 'e', targetLocalId: 'local', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'exact', sourceText: 'work' }];
    expect(hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph: state, document: delta, uncertainty: state.uncertainties[0] })).toBe(false);
    delta.tasks[0].existingPublicId = 't'; delta.tasks[0].title = 't';
    expect(hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph: state, document: delta, uncertainty: state.uncertainties[0] })).toBe(true);
    delta.tasks[0].effortEstimates[0].kind = 'session_duration'; delta.tasks[0].effortEstimates[0].unitCode = null;
    expect(hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph: state, document: delta, uncertainty: state.uncertainties[0] })).toBe(false);
  });
  it.each(['replace', 'modify'] as const)('admits only the existing exact formal window %s path', operation => {
    const state = graph('planning_window');
    state.planningWindows = [{ id: 'window', kind: 'absolute', value: '2026-08-17', start: '2026-08-17', end: '2026-08-17', source, createdRevision: 1 }];
    state.factLifecycles.push({ factId: 'window', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    state.uncertainties[0].targetFactId = 'window';
    const delta = document(); delta.tasks = [];
    delta.planningWindow = { localId: 'new-window', kind: 'absolute', value: '2026-08-18', start: '2026-08-18', end: '2026-08-18', sourceText: 'work' };
    delta.corrections = [{ localId: 'correct-window', target: { kind: 'planning_window', publicId: 'window', localId: null, mention: 'work' }, operation, replacementLocalId: 'new-window', sourceText: 'work' }];
    const resolves = (candidate: WeeklyPlanningSemanticDocumentV5, candidateGraph = state) => hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph: candidateGraph, document: candidate, uncertainty: candidateGraph.uncertainties[0] });
    expect(resolves(delta)).toBe(true);
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({ document: delta, currentUserText: 'work' })).toEqual([]);
    const copiedCorrection = structuredClone(delta); copiedCorrection.corrections[0].sourceText = 'previous correction';
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({ document: copiedCorrection, currentUserText: 'work', supplementalContext: 'previous correction' }))
      .toContain('document.corrections[0].sourceText:not-grounded-in-current-user-text');
    for (const mutation of ['absent-correction', 'other-target', 'other-replacement', 'wrong-kind', 'remove', 'retained', 'retained-replacement', 'missing-window', 'historical-target', 'other-dimension'] as const) {
      const candidate = structuredClone(delta); const candidateGraph = structuredClone(state);
      if (mutation === 'absent-correction') candidate.corrections = [];
      if (mutation === 'other-target') candidate.corrections[0].target.publicId = 'other';
      if (mutation === 'other-replacement') candidate.corrections[0].replacementLocalId = 'absent';
      if (mutation === 'wrong-kind') candidate.corrections[0].target.kind = 'task';
      if (mutation === 'remove') candidate.corrections[0].operation = 'remove';
      if (mutation === 'retained') candidate.uncertainties = [{ localId: 'still-unknown', targetLocalId: 'document', field: 'planning_window', reason: 'unknown', sourceText: 'work' }];
      if (mutation === 'retained-replacement') candidate.uncertainties = [{ localId: 'still-unknown', targetLocalId: 'new-window', field: 'planning_window', reason: 'unknown', sourceText: 'work' }];
      if (mutation === 'missing-window') candidate.planningWindow = null;
      if (mutation === 'historical-target') candidateGraph.factLifecycles.find(entry => entry.factId === 'window')!.status = 'removed';
      if (mutation === 'other-dimension') candidateGraph.uncertainties[0].field = 'material_identity';
      expect(resolves(candidate, candidateGraph), mutation).toBe(false);
    }
  });
  it('preserves a required window question through an unrelated normal commit', () => {
    const state = graph('planning_window'); state.planningWindows = [{ id: 'window', kind: 'absolute', value: '2026-08-17', start: '2026-08-17', end: '2026-08-17', source, createdRevision: 1 }];
    state.factLifecycles.push({ factId: 'window', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    state.uncertainties[0].targetFactId = 'window';
    const delta = document();
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
    expectActive(commit(state, delta).graph);
  });
});
