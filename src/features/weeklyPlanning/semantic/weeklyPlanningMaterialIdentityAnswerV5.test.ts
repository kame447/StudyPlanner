import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5, weeklyPlanningMaterialIdentityAnswersV5 } from './weeklyPlanningMaterialIdentityAnswerV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { projectWeeklyPlanningExistingWorkloadRateReferenceV5 } from './weeklyPlanningExistingWorkloadRateReferenceV5';
import { reconcileWeeklyPlanningGroundingRecordsV5 } from './weeklyPlanningGroundingV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphValidatorV5';

const source = { conversationId: 'c', turnId: 'initial', semanticLocalId: 'm', sourceText: '数学の問題集を20問', origin: 'user' as const };
function state() {
  const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.revision = 1;
  graph.tasks = [{ id: 't', category: 'study', title: '数学', createdRevision: 1, source }];
  graph.components = [{ id: 'm', taskId: 't', parentComponentId: null, role: 'material', label: '数学の問題集', createdRevision: 1, source }];
  graph.workloads = [{ id: 'w', taskId: 't', componentId: 'm', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, createdRevision: 1, source }];
  graph.uncertainties = [{ id: 'u', targetFactId: 'm', field: 'material_identity', reason: '未確定', createdRevision: 1, source }, { id: 'other', targetFactId: 'm', field: 'unrelated', reason: '別の確認', createdRevision: 1, source }];
  graph.factLifecycles = ['t', 'm', 'w', 'u', 'other'].map((factId) => ({ factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
  return graph;
}
function answer(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [{ localId: 'task', existingPublicId: 't', category: 'study', title: '数学', decompositionStatus: 'atomic',
      study: { purpose: 'self_study', contextLabel: null, components: [{ localId: 'material', existingPublicId: 'm', parentLocalId: null, role: 'material', label: '青チャート 数学III', workloads: [], sourceText: '青チャート' }] },
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: '青チャート' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };
}
describe('exact component identity transaction safety', () => {
  it('preserves work provenance and unrelated needs, retaining historical component source', () => {
    const graph = state();
    graph.revision = 2;
    graph.components.push({ ...graph.components[0], id: 'child', role: 'chapter', parentComponentId: 'm', label: '演習' });
    graph.effortEstimates.push({ id: 'pace', taskId: 't', targetFactId: 'm', kind: 'duration_per_unit', minutes: 3,
      unitCode: 'problem', precision: 'approximate', source, createdRevision: 1 });
    graph.correctionIntents.push({ id: 'earlier-correction', target: { kind: 'component', publicId: 'm', factId: 'm', mention: null },
      operation: 'modify', replacementFactId: 'm', source, createdRevision: 1 });
    graph.decisionIntents.push({ id: 'earlier-decision', target: { kind: 'component', publicId: 'm', factId: 'm', mention: null },
      decision: 'accept', source, createdRevision: 1 });
    graph.correctionIntents.push({ ...graph.correctionIntents[0], id: 'historical-correction' });
    graph.factLifecycles.push({ factId: 'historical-correction', status: 'removed', createdRevision: 1, terminalRevision: 2, supersededByFactId: null });
    for (const factId of ['child', 'pace', 'earlier-correction', 'earlier-decision']) graph.factLifecycles.push({ factId, status: 'active', createdRevision: 1,
      terminalRevision: null, supersededByFactId: null });
    const before = structuredClone(graph); const document = answer();
    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document, context: { conversationId: 'c', turnId: 'answer', expectedRevision: graph.revision } });
    const result = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: graph, document, baseCanonicalization: base,
      contextualAnswer: false, questionCode: 'semantic_uncertainty', operationKeyPrefix: 'c:answer', conversationArchitecture: 'interaction_v1' }).canonicalization;
    expect(result.status).toBe('applied');
    const replacementId = result.localToFactId.material;
    expect(result.graph.workloads).toEqual([{ ...before.workloads[0], componentId: replacementId }]);
    expect(result.graph.components.find((fact) => fact.id === 'm')).toEqual(before.components[0]);
    expect(result.graph.components.find((fact) => fact.id === 'child')).toEqual({ ...before.components[1], parentComponentId: replacementId });
    expect(result.graph.effortEstimates).toEqual([{ ...before.effortEstimates[0], targetFactId: replacementId }]);
    expect(result.graph.correctionIntents[0]).toEqual({ ...before.correctionIntents[0],
      target: { ...before.correctionIntents[0].target, publicId: replacementId, factId: replacementId }, replacementFactId: replacementId });
    expect(result.graph.correctionIntents[1]).toEqual(before.correctionIntents[1]);
    expect(result.graph.decisionIntents[0].target).toMatchObject({ publicId: replacementId, factId: replacementId });
    expect(result.graph.uncertainties.find((fact) => fact.id === 'other')?.targetFactId).toBe(replacementId);
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'other', status: 'active' }));
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'u', status: 'removed' }));
    expect(graph).toEqual(before);
    const priorGrounding = [{ id: 'old-grounding', targetFactId: 'm', interpretationKind: 'relative_date_resolution' as const,
      status: 'contested' as const, sourceExpression: 'next_week', startDate: '2026-10-12', endDate: '2026-10-18', proposedAtTurnId: 'initial', acceptedAtTurnId: null }];
    expect(reconcileWeeklyPlanningGroundingRecordsV5({ previousRecords: priorGrounding, previousGraph: before,
      nextGraph: result.graph, resolvedHorizon: null, currentTurnId: 'answer', continuationAccepted: false })).toEqual([{ ...priorGrounding[0], status: 'rejected' }]);
    expect(priorGrounding[0].status).toBe('contested');
    const decoded = parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(result.graph));
    expect(decoded.errors).toEqual([]);
    expect(decoded.graph).toEqual(result.graph);
  });
  it('classifies every graph collection that could acquire a component reference', () => {
    expect(Object.keys(WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5).sort()).toEqual(Object.keys(createEmptyWeeklyPlanningFactGraphV5()).sort());
    expect(Object.entries(WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5).filter(([, fields]) => fields.length).map(([name]) => name)).toEqual([
      'components', 'workloads', 'effortEstimates', 'temporalConstraints', 'taskDateRules', 'recurrences', 'uncertainties', 'correctionIntents', 'decisionIntents',
    ]);
    expect(WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5.relations).toEqual([]);
  });
  it('does not treat a rate, unchanged label or foreign task binding as identity resolution', () => {
    const graph = state(); const unchanged = answer(); unchanged.tasks[0].study!.components[0].label = '数学の問題集';
    expect(weeklyPlanningMaterialIdentityAnswersV5(graph, unchanged)).toEqual([]);
    const foreign = answer(); foreign.tasks[0].existingPublicId = 'another-task';
    expect(weeklyPlanningMaterialIdentityAnswersV5(graph, foreign)).toEqual([]);
    const effort = answer(); effort.tasks[0].study!.components = [];
    expect(weeklyPlanningMaterialIdentityAnswersV5(graph, effort)).toEqual([]);
  });
  it('does not broaden a public workload rate across multiple compatible scopes', () => {
    const graph = state(); graph.workloads.push({ ...graph.workloads[0], id: 'w2', componentId: null });
    graph.factLifecycles.push({ factId: 'w2', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const document = answer(); document.tasks[0].study!.components = [];
    document.tasks[0].effortEstimates = [{ localId: 'rate', targetLocalId: 'w', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'exact', sourceText: '1問3分' }];
    const rawResponse = JSON.stringify(document);
    expect(projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse, graph })).toEqual({ rawResponse, repairs: [] });
  });
  it.each(['different_amount', 'foreign_component', 'new_scope', 'wrong_unit', 'unknown_target'] as const)('leaves %s public rate references for ordinary validation/repair', (variant) => {
    const graph = state();
    const document = answer();
    const { id: _id, taskId: _taskId, componentId: _componentId, source: _source, createdRevision: _revision, ...quantity } = graph.workloads[0];
    const replay = { ...quantity, localId: 'w', sourceText: '20問' };
    document.tasks[0].study!.components[0].workloads = [replay];
    document.tasks[0].effortEstimates = [{ localId: 'rate', targetLocalId: 'w', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'exact', sourceText: '1問3分' }];
    if (variant === 'different_amount') replay.amount = 21;
    if (variant === 'foreign_component') document.tasks[0].study!.components[0].existingPublicId = 'other-material';
    if (variant === 'new_scope') document.tasks[0].workloads = [{ ...replay, localId: 'additional' }];
    if (variant === 'wrong_unit') document.tasks[0].effortEstimates[0].unitCode = 'page';
    if (variant === 'unknown_target') document.tasks[0].effortEstimates[0].targetLocalId = 'unknown';
    const rawResponse = JSON.stringify(document);
    expect(projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse, graph })).toEqual({ rawResponse, repairs: [] });
  });
  it('keeps legacy component binding and its uncertainty unchanged', () => {
    const graph = state(); const document = answer();
    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document, context: { conversationId: 'c', turnId: 'answer', expectedRevision: 1 } });
    const result = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: graph, document, baseCanonicalization: base,
      contextualAnswer: false, questionCode: 'semantic_uncertainty', operationKeyPrefix: 'c:answer', conversationArchitecture: 'legacy_v5' }).canonicalization;
    expect(result.graph.components).toEqual(graph.components);
    expect(result.graph.uncertainties).toEqual(graph.uncertainties);
    expect(result.graph.workloads).toEqual(graph.workloads);
  });
});

describe('identity refinement without an open material question (live B on 64436073)', () => {
  function withoutNeed() {
    const graph = state();
    graph.uncertainties = graph.uncertainties.filter((need) => need.id !== 'u');
    graph.factLifecycles = graph.factLifecycles.filter((lifecycle) => lifecycle.factId !== 'u');
    return graph;
  }
  it('treats a pure relabel of a bound material as its identification and moves dependents to the new version', () => {
    const graph = withoutNeed(); const before = structuredClone(graph); const document = answer();
    expect(weeklyPlanningMaterialIdentityAnswersV5(graph, document)).toEqual([{ targetId: 'm', localId: 'material', uncertaintyIds: [] }]);
    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document, context: { conversationId: 'c', turnId: 'name', expectedRevision: 1 } });
    const result = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: graph, document, baseCanonicalization: base,
      contextualAnswer: false, questionCode: null, operationKeyPrefix: 'c:name', conversationArchitecture: 'interaction_v1' }).canonicalization;
    expect(result.status).toBe('applied');
    const replacementId = result.localToFactId.material;
    expect(result.graph.components.find((fact) => fact.id === replacementId)).toMatchObject({ label: '青チャート 数学III', taskId: 't', role: 'material' });
    expect(result.graph.components.find((fact) => fact.id === 'm')).toEqual(before.components[0]);
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'm', status: 'superseded', supersededByFactId: replacementId }));
    expect(result.graph.workloads).toEqual([{ ...before.workloads[0], componentId: replacementId }]);
    expect(result.graph.uncertainties.find((fact) => fact.id === 'other')).toMatchObject({ targetFactId: replacementId });
    expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'other', status: 'active' }));
    expect(graph).toEqual(before);
  });
  it.each([
    ['carries new work', (document: WeeklyPlanningSemanticDocumentV5) => {
      document.tasks[0].study!.components[0].workloads = [{ localId: 'more', quantityRole: 'target', amount: 5, unitCode: 'problem', unitLabel: '問',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '青チャート' }];
    }],
    ['carries a durable signal', (document: WeeklyPlanningSemanticDocumentV5) => {
      document.tasks[0].study!.components[0].durableContextSignals = [{ localId: 'concern', kind: 'concern', value: '難しい', sourceText: '青チャート' }];
    }],
    ['differs only by evidence normalization', (document: WeeklyPlanningSemanticDocumentV5) => {
      document.tasks[0].study!.components[0].label = '「数学の問題集」';
    }],
    ['is not a material', (document: WeeklyPlanningSemanticDocumentV5) => {
      document.tasks[0].study!.components[0].role = 'chapter';
    }],
    ['re-raises the material question', (document: WeeklyPlanningSemanticDocumentV5) => {
      document.uncertainties = [{ localId: 'again', targetLocalId: 'material', field: 'material_identity', reason: '未確定', sourceText: '青チャート' }];
    }],
  ])('keeps the binding-only shell when the relabel %s', (_name, mutate) => {
    const document = answer(); mutate(document);
    expect(weeklyPlanningMaterialIdentityAnswersV5(withoutNeed(), document)).toEqual([]);
  });
  it('keeps legacy binding-only without an open question', () => {
    const graph = withoutNeed(); const document = answer();
    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document, context: { conversationId: 'c', turnId: 'name', expectedRevision: 1 } });
    const result = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: graph, document, baseCanonicalization: base,
      contextualAnswer: false, questionCode: null, operationKeyPrefix: 'c:name', conversationArchitecture: 'legacy_v5' }).canonicalization;
    expect(result.graph.components).toEqual(graph.components);
    expect(result.graph.workloads).toEqual(graph.workloads);
  });
});
