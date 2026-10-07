import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { applyWeeklyPlanningStableV5ContextualAnswer, evaluateWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';

const source = { conversationId: 'c', turnId: 'first', semanticLocalId: 't', sourceText: 'work', origin: 'user' as const };

function graph(field = 'work_breakdown'): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    tasks: ['t', 'other'].map((id) => ({ id, category: 'study' as const, title: id, source, createdRevision: 1 })),
    components: [{ id: 'existing-material', taskId: 't', parentComponentId: null, role: 'material', label: 'work', source, createdRevision: 1 }],
    uncertainties: ['t', 'other'].map((targetFactId) => ({ id: `u-${targetFactId}`, targetFactId, field, reason: 'unknown', source, createdRevision: 1 })),
    factLifecycles: ['t', 'other', 'existing-material', 'u-t', 'u-other'].map((factId) => ({
      factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null,
    })),
  };
}

function document(target = 't', existingComponent = false): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [{
      localId: 'local', existingPublicId: target, decompositionStatus: 'decomposed', category: 'study', title: target,
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [{
        localId: 'material', existingPublicId: existingComponent ? 'existing-material' : null, parentLocalId: null,
        role: 'material', label: 'work', workloads: [], durableContextSignals: [], sourceText: 'work',
      }] },
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: 'work',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
}

function input(state: WeeklyPlanningFactGraphV5, delta: WeeklyPlanningSemanticDocumentV5) {
  return {
    graph: state, document: delta, pendingQuestion: {
      actionId: 'q', questionCode: 'semantic_uncertainty', targetFactId: 'u-t', graphRevision: 1,
    }, conversationId: 'c', turnId: 'answer', expectedRevision: 1, userText: 'work',
  };
}

describe('semantic uncertainty answers require the pending target and dimension', () => {
  it('does not use a structural answer for another task to retire the pending task need', () => {
    const request = input(graph(), document('other'));
    expect(evaluateWeeklyPlanningStableV5ContextualAnswer(request)).toMatchObject({
      status: 'incompatible', reason: 'uncertainty_not_resolved',
    });
    expect(applyWeeklyPlanningStableV5ContextualAnswer(request)).toBeNull();
  });

  it('retires only the exact pending requirement when its material answer is supplied', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer(input(graph('material_identity'), document()))!;
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-t', status: 'removed' }));
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-other', status: 'active' }));
  });

  it('accepts a new exact-target material contribution for a free-form uncertainty field', () => {
    const request = input(graph('future_required_dimension'), document());
    const result = applyWeeklyPlanningStableV5ContextualAnswer(request)!;
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-t', status: 'removed' }));
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-other', status: 'active' }));
  });

  it.each(['material', 'future_required_dimension', '教材の未確認事項'])('keeps free field %s open for costs, shells, reused structure and sibling answers', (field) => {
    const state = graph(field);
    const shell = document();
    shell.tasks[0].study!.components = [];
    for (const kind of ['total_duration', 'duration_per_unit', 'session_duration'] as const) {
      const delta = structuredClone(shell);
      delta.tasks[0].effortEstimates = [{ localId: 'e', targetLocalId: 'local', kind, minutes: 3, unitCode: kind === 'duration_per_unit' ? 'problem' : null, precision: 'approximate', sourceText: 'work' }];
      expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
    }
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, shell))).toBeNull();
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, document('t', true)))).toBeNull();
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, document('other')))).toBeNull();
  });

  it('accepts a new content workload for the bound target, but not a replay or a clock-unit budget', () => {
    const state = graph('material');
    const delta = document();
    delta.tasks[0].study!.components = [];
    const work = { localId: 'wl', quantityRole: 'target' as const, amount: 20, unitCode: 'problem' as const, unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: 'work' };
    delta.tasks[0].workloads = [work];
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))?.graph.factLifecycles)
      .toContainEqual(expect.objectContaining({ factId: 'u-t', status: 'removed' }));
    state.workloads = [{ ...work, id: 'existing-work', taskId: 't', componentId: null, source, createdRevision: 1 }];
    state.factLifecycles.push({ factId: 'existing-work', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
    delta.tasks[0].workloads[0] = { ...work, amount: 2, unitCode: 'hour', unitLabel: '時間' };
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
  });

  it('keeps a free-form requirement explicitly retained on the exact target, even with new structure', () => {
    const delta = document();
    delta.uncertainties = [{ localId: 'still-unclear', targetLocalId: 'local', field: 'material', reason: 'still unknown', sourceText: 'work' }];
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(graph('material'), delta))).toBeNull();
  });

  it.each(['work_breakdown', 'material_identity'])('handles a positive total budget according to the %s dimension', (field) => {
    const delta = document();
    delta.tasks[0].decompositionStatus = 'atomic';
    delta.tasks[0].study!.components = [];
    delta.tasks[0].effortEstimates = [{ localId: 'e', targetLocalId: 'local', kind: 'total_duration', minutes: 120, unitCode: null, precision: 'approximate', sourceText: 'work' }];
    const request = input(graph(field), delta);
    const result = applyWeeklyPlanningStableV5ContextualAnswer(request);
    if (field === 'work_breakdown') {
      expect(result?.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-t', status: 'removed' }));
    } else {
      expect(result).toBeNull();
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('does not retire structure on an unusable time budget (%s)', (minutes) => {
    const delta = document();
    delta.tasks[0].study!.components = [];
    delta.tasks[0].effortEstimates = [{ localId: 'e', targetLocalId: 'local', kind: 'total_duration', minutes, unitCode: null, precision: 'exact', sourceText: 'work' }];
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(graph(), delta))).toBeNull();
  });

  it('keeps structure open when the task total conflicts with an accepted total', () => {
    const state = graph();
    state.effortEstimates = [{ id: 'old', taskId: 't', targetFactId: 't', kind: 'total_duration', minutes: 60, unitCode: null, precision: 'exact', source, createdRevision: 1 }];
    state.factLifecycles.push({ factId: 'old', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const delta = document();
    delta.tasks[0].study!.components = [];
    delta.tasks[0].effortEstimates = [{ localId: 'e', targetLocalId: 'local', kind: 'total_duration', minutes: 120, unitCode: null, precision: 'exact', sourceText: 'work' }];
    expect(applyWeeklyPlanningStableV5ContextualAnswer(input(state, delta))).toBeNull();
  });

  it.each(['interaction_v1', 'legacy_v5'] as const)('%s: a replayed existing component keeps the comparison behavior at the final commit', (conversationArchitecture) => {
    const originalGraph = graph();
    const delta = document('t', true);
    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: originalGraph, document: delta, context: { conversationId: 'c', turnId: 'answer', expectedRevision: 1 },
    });
    const committed = finalizeWeeklyPlanningSemanticCanonicalizationV5({
      originalGraph, document: delta, baseCanonicalization: base, contextualAnswer: false,
      questionCode: 'semantic_uncertainty', operationKeyPrefix: 'c:answer', conversationArchitecture,
    });
    expect(committed.canonicalization.status).toBe('applied');
    expect(committed.canonicalization.graph.factLifecycles).toContainEqual(expect.objectContaining({
      factId: 'u-t', status: conversationArchitecture === 'interaction_v1' ? 'active' : 'removed',
    }));
    expect(committed.canonicalization.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-other', status: 'active' }));
  });

  it('preserves the legacy contextual answer behavior for an unrelated delta', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({ ...input(graph(), document('other')), conversationArchitecture: 'legacy_v5' })!;
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u-t', status: 'removed' }));
  });
});
