import { describe, expect, it, vi } from 'vitest';
import * as lifecycleEngine from './weeklyPlanningFactLifecycleEngineV5';
import { materialIdentityDocument as answer, materialIdentityState as state, materialIdentitySource as source, MATERIAL_IDENTITY_TEXT as text } from '../testUtils/__tests__/weeklyPlanningMaterialIdentityFixture';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphValidatorV5';
import { isWeeklyPlanningFactActiveV5 as active } from './weeklyPlanningFactLifecycleV5';
import { WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5, weeklyPlanningMaterialIdentityAnswersV5 } from './weeklyPlanningMaterialIdentityAnswerV5';

function run(document = answer(), graph = state(), options: { userText?: string; supplementalContext?: string; expectedRevision?: number } = {}) {
  const before = structuredClone(graph);
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).errors).toEqual([]);
  const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
    currentUserText: options.userText ?? document.tasks[0].sourceText,
    supplementalContext: options.supplementalContext, committedGraph: graph,
    publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5({}, graph),
  });
  const base = validation.document ? canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document: validation.document,
    context: { conversationId: 'c', turnId: 'identity', userText: options.userText ?? document.tasks[0].sourceText,
      supplementalContext: options.supplementalContext, expectedRevision: options.expectedRevision ?? graph.revision } }) : null;
  const result = base && validation.document ? finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: graph, document: validation.document,
    baseCanonicalization: base, contextualAnswer: false, questionCode: null, operationKeyPrefix: 'c:identity' }).canonicalization : null;
  expect(graph).toEqual(before);
  const final = result?.graph ?? graph;
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(final)).errors).toEqual([]);
  return { validation, result, graph: final, before };
}

function preserved(out: ReturnType<typeof run>, replacement = 'm') {
  expect(out.graph.workloads).toEqual([{ ...out.before.workloads[0], componentId: replacement }]);
  expect(out.graph.effortEstimates).toEqual(out.before.effortEstimates);
  expect(out.graph.temporalConstraints).toEqual([{ ...out.before.temporalConstraints[0], targetFactId: replacement }]);
  expect(out.graph.components.find(fact => fact.id === 'm')).toEqual(out.before.components[0]);
  expect(out.graph.uncertainties.find(fact => fact.id === 'other')).toEqual({ ...out.before.uncertainties.find(fact => fact.id === 'other'), targetFactId: replacement });
  for (const id of ['w', 'pace', 'preference', 'other']) expect(active(out.graph, id)).toBe(true);
}

describe('explicit material identity transaction through real validation and binding', () => {
  it.each([true, false])('versions typed modify with open material need=%s', hasNeed => {
    const out = run(answer(), state(hasNeed));
    expect(out.validation.errors).toEqual([]);
    expect(out.result?.status).toBe('applied');
    const id = out.result!.localToFactId.material;
    expect(id).not.toBe('m');
    expect(out.graph.components.find(fact => fact.id === id)).toMatchObject({ label: '青チャート 数学III', taskId: 't', role: 'material' });
    expect(out.graph.factLifecycles.find(fact => fact.factId === 'm')).toMatchObject({ status: 'superseded', supersededByFactId: id });
    if (hasNeed) expect(active(out.graph, 'u')).toBe(false);
    expect(out.graph.correctionIntents.every(fact => !active(out.graph, fact.id))).toBe(true);
    expect(out.result!.diff!.removed).toContainEqual({ kind: 'correction_intent', id: out.result!.localToFactId.correction });
    preserved(out, id);
  });
  it.each(['relabel', 'reference'] as const)('keeps %s binding-only even with an open question', shape => {
    const out = run(answer(shape));
    expect(out.validation.errors).toEqual([]);
    expect(out.result?.status).toBe('applied');
    expect(out.result?.diff).toMatchObject({ added: [], removed: [], superseded: [] });
    expect(active(out.graph, 'u')).toBe(true); preserved(out);
  });
  it('adds ordinary additional material without moving accepted work or closing its question', () => {
    const out = run(answer('addition'));
    expect(out.result?.status).toBe('applied');
    expect(out.graph.components.filter(fact => active(out.graph, fact.id))).toHaveLength(2);
    expect(active(out.graph, 'u')).toBe(true); preserved(out);
  });
  it.each(['replace_new', 'remove'] as const)('does not grant general %s component replacement/removal', shape => {
    const out = run(answer(shape));
    expect(!out.validation.document || out.result?.status === 'rejected').toBe(true);
    expect(out.graph).toEqual(out.before);
  });
  it('uses typed meaning without a label/source-overlap heuristic', () => {
    const document = answer();
    document.tasks[0].sourceText = 'さっきの教材名を正式名称に訂正してください';
    document.tasks[0].study!.components[0].sourceText = document.tasks[0].sourceText;
    document.corrections[0].sourceText = document.tasks[0].sourceText;
    const out = run(document);
    expect(out.validation.errors).toEqual([]); expect(out.result?.status).toBe('applied');
    expect(out.result?.localToFactId.material).not.toBe('m');
  });
  it.each(['unknown', 'foreign-task', 'inactive', 'inactive-task', 'duplicate-target', 'duplicate-correction', 'conflicting-remove', 'registry-uuid', 'stale-source', 'supplemental-source', 're-raised-need', 'local-target', 'same-label', 'different-role'] as const)('rejects %s atomically', variant => {
    const graph = state(); const document = answer();
    const component = document.tasks[0].study!.components[0];
    const options: Parameters<typeof run>[2] = {};
    if (variant === 'unknown') component.existingPublicId = 'unknown';
    if (variant === 'foreign-task') { graph.tasks.push({ ...graph.tasks[0], id: 'foreign' }); graph.factLifecycles.push({ ...graph.factLifecycles[0], factId: 'foreign' }); document.tasks[0].existingPublicId = 'foreign'; }
    if (variant === 'inactive' || variant === 'inactive-task') {
      graph.revision = 2;
      graph.factLifecycles = graph.factLifecycles.map(entry => entry.factId !== 't' || variant === 'inactive-task'
        ? { ...entry, status: 'removed', terminalRevision: 2 } : entry);
    }
    if (variant === 'duplicate-target') document.tasks[0].study!.components.push({ ...component, localId: 'duplicate' });
    if (variant === 'duplicate-correction') document.corrections.push({ ...document.corrections[0], localId: 'duplicate' });
    if (variant === 'conflicting-remove') document.corrections.push({ ...document.corrections[0], localId: 'remove', operation: 'remove', replacementLocalId: null });
    if (variant === 'registry-uuid') component.existingPublicId = 'book-blue';
    if (variant === 'stale-source') options.userText = 'ありがとう';
    if (variant === 'supplemental-source') { options.userText = '名前を訂正してください'; options.supplementalContext = text; document.corrections[0].sourceText = options.userText; }
    if (variant === 're-raised-need') document.uncertainties.push({ localId: 'again', targetLocalId: 'task', field: 'material_identity', reason: '未確定', sourceText: text });
    if (variant === 'local-target') document.corrections[0].target = { kind: 'component', publicId: null, localId: 'material', mention: null };
    if (variant === 'same-label') component.label = graph.components[0].label;
    if (variant === 'different-role') component.role = 'chapter';
    const out = run(document, graph, options);
    expect(!out.validation.document || out.result?.status === 'rejected').toBe(true);
    expect(out.graph).toEqual(out.before);
  });
  it('rejects stale revisions and makes turn replay idempotent', () => {
    const stale = run(answer(), state(), { expectedRevision: 0 });
    expect(stale.result?.status).toBe('rejected'); expect(stale.graph).toEqual(stale.before);
    const first = run();
    const repeated = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: first.graph, document: first.validation.document!,
      context: { conversationId: 'c', turnId: 'identity', expectedRevision: first.graph.revision } });
    expect(repeated.status).toBe('duplicate'); expect(repeated.graph).toEqual(first.graph);
  });
  it('rolls back the entire transaction when the matching-need lifecycle operation fails', () => {
    const apply = lifecycleEngine.applyWeeklyPlanningFactLifecycleOperationV5;
    const fault = vi.spyOn(lifecycleEngine, 'applyWeeklyPlanningFactLifecycleOperationV5').mockImplementation(params =>
      params.operation.targetFactId === 'u' ? {
        engineVersion: lifecycleEngine.WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
        status: 'rejected', graph: params.graph, superseded: [], removed: [], errors: ['injected-need-lifecycle-failure'],
      } : apply(params));
    try {
      const out = run();
      expect(out.validation.errors).toEqual([]);
      expect(fault).toHaveBeenCalledWith(expect.objectContaining({ operation: expect.objectContaining({ kind: 'remove', targetFactId: 'u' }) }));
      expect(out.result?.status).toBe('rejected');
      expect(out.result?.errors).toEqual(['injected-need-lifecycle-failure']);
      expect(out.graph).toEqual(out.before);
    } finally { fault.mockRestore(); }
  });
  it('rolls the identity and needs back if a later independent correction fails', () => {
    const document = answer();
    document.corrections.push({ localId: 'invalid', operation: 'remove', target: { kind: 'task', publicId: 't', localId: null, mention: null }, replacementLocalId: null, sourceText: text });
    const out = run(document);
    expect(out.result?.status).toBe('rejected'); expect(out.graph).toEqual(out.before);
  });
});

describe('schema-valid active reference closure', () => {
  it('moves active references, preserving payload/source/IDs and inactive history; date rules stay task-only', () => {
    const graph = state(); graph.revision = 2;
    graph.components.push({ ...graph.components[0], id: 'child', role: 'chapter', parentComponentId: 'm', label: '演習' });
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'direct-pace', targetFactId: 'm' });
    graph.taskDateRules.push({ id: 'date-rule', taskId: 't', targetFactId: 't', kind: 'allowed_date', dateExpression: '2026-10-12', constraintLevel: 'hard', createdRevision: 1, source });
    graph.recurrences.push({ id: 'recurrence', taskId: 't', targetFactId: 'm', kind: 'times_per_week', count: 2, days: [], createdRevision: 1, source });
    graph.correctionIntents.push({ id: 'earlier-correction', target: { kind: 'component', publicId: 'm', factId: 'm', mention: null }, operation: 'modify', replacementFactId: 'm', createdRevision: 1, source });
    graph.decisionIntents.push({ id: 'earlier-decision', target: { kind: 'component', publicId: 'm', factId: 'm', mention: null }, decision: 'accept', createdRevision: 1, source });
    graph.correctionIntents.push({ ...graph.correctionIntents[0], id: 'historical-correction' });
    graph.workloads.push({ ...graph.workloads[0], id: 'historical-workload' });
    for (const factId of ['historical-correction', 'historical-workload']) graph.factLifecycles.push({ factId, status: 'removed', createdRevision: 1, terminalRevision: 2, supersededByFactId: null });
    for (const factId of ['child', 'direct-pace', 'date-rule', 'recurrence', 'earlier-correction', 'earlier-decision']) graph.factLifecycles.push({ factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const out = run(answer(), graph); expect(out.validation.errors).toEqual([]); expect(out.result?.status).toBe('applied');
    const id = out.result!.localToFactId.material;
    expect(out.graph.components.find(fact => fact.id === 'child')).toEqual({ ...out.before.components[1], parentComponentId: id });
    expect(out.graph.workloads).toEqual([{ ...out.before.workloads[0], componentId: id }, out.before.workloads[1]]);
    expect(out.graph.effortEstimates).toEqual([out.before.effortEstimates[0], { ...out.before.effortEstimates[1], targetFactId: id }]);
    expect(out.graph.temporalConstraints).toEqual([{ ...out.before.temporalConstraints[0], targetFactId: id }]);
    expect(out.graph.taskDateRules).toEqual(out.before.taskDateRules);
    expect(out.graph.recurrences).toEqual([{ ...out.before.recurrences[0], targetFactId: id }]);
    expect(out.graph.correctionIntents[0]).toEqual({ ...out.before.correctionIntents[0], target: { ...out.before.correctionIntents[0].target, publicId: id, factId: id }, replacementFactId: id });
    expect(out.graph.correctionIntents[1]).toEqual(out.before.correctionIntents[1]);
    expect(out.graph.decisionIntents[0]).toEqual({ ...out.before.decisionIntents[0], target: { ...out.before.decisionIntents[0].target, publicId: id, factId: id } });
    expect(out.graph.components[0]).toEqual(out.before.components[0]);
  });
  it.each([true, false])('retains the exact accepted nested parent, represented=%s', represented => {
    const graph = state(); graph.components.push({ ...graph.components[0], id: 'parent', role: 'chapter' });
    graph.components[0].parentComponentId = 'parent';
    graph.factLifecycles.push({ ...graph.factLifecycles[0], factId: 'parent' });
    const document = answer();
    if (represented) {
      document.tasks[0].study!.components.push({ ...document.tasks[0].study!.components[0], localId: 'parent-local', existingPublicId: 'parent', role: 'chapter', label: graph.components[1].label });
      document.tasks[0].study!.components[0].parentLocalId = 'parent-local';
    }
    const out = run(document, graph);
    if (represented) { expect(out.result?.status).toBe('applied'); expect(out.graph.components.find(fact => fact.id === out.result!.localToFactId.material)?.parentComponentId).toBe('parent'); }
    else { expect(out.validation.document).toBeNull(); expect(out.graph).toEqual(out.before); }
  });
  it('classifies every graph collection without allowing task-only date rules to migrate', () => {
    expect(Object.keys(WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5).sort()).toEqual(Object.keys(state()).sort());
    expect(WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5.taskDateRules).toEqual([]);
    expect(WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5.relations).toEqual([]);
    expect(weeklyPlanningMaterialIdentityAnswersV5(state(), answer('relabel'))).toEqual([]);
  });
});
