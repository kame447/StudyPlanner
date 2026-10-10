import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createStableV5SemanticPublicStateSummary } from './weeklyPlanningStableV5SemanticContext';

import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { applyWeeklyPlanningExistingEntityBindingsV5 } from '../semantic/weeklyPlanningExistingEntityBindingApplicationV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { normalizePendingQuestionEntityBindingsV5 } from '../semantic/weeklyPlanningPendingEntityBindingNormalizationV5';

import { parseWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5 } from '../semantic/weeklyPlanningAvailabilityCorrectionCompatibilityV5';
import { validateWeeklyPlanningSemanticEvidenceV5 } from '../semantic/weeklyPlanningSemanticEvidenceV5';
import { validateWeeklyPlanningCurrentTurnProvenanceV5 } from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';

const OWNER_ID = 'owner-material-semantic-context';

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'gold-phrase',
    userId: OWNER_ID,
    name: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    subjectId: 'english',
    subjectName: '英語',
    aliases: ['金フレ'],
    status: 'active',
    paceEnabled: true,
    progressUnit: 'word',
    totalUnits: 1000,
    currentUnit: 200,
    targetDate: '2026-09-07',
    catalogEntryId: 'seed:gold-phrase',
    catalogTitle: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('Stable V5 registered material semantic context', () => {
  it('publishes the mentioned bookshelf material as structured known context', () => {
    const studyMaterials = [
      material({
        id: 'other-material',
        name: '別の教材',
        aliases: [],
        updatedAt: '2026-08-30T00:00:00.000Z',
      }),
      material(),
    ];

    const summary = createStableV5SemanticPublicStateSummary({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      messages: [],
      ownerId: OWNER_ID,
      currentDate: '2026-08-29',
      userText: '明日から金フレを9月7日まで進めたい',
      studyMaterials,
    });

    expect(summary.registeredMaterials).toEqual([
      expect.objectContaining({
        materialId: 'gold-phrase',
        aliases: ['金フレ'],
        progressUnit: 'word',
        totalUnits: 1000,
        currentUnit: 200,
        remainingUnits: 800,
        targetDate: '2026-09-07',
      }),
      expect.objectContaining({ materialId: 'other-material' }),
    ]);
  });

  it('does not publish another user material roster', () => {
    const summary = createStableV5SemanticPublicStateSummary({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      messages: [],
      ownerId: 'different-owner',
      currentDate: '2026-08-29',
      userText: '金フレを進めたい',
      studyMaterials: [material()],
    });

    expect(summary.registeredMaterials).toEqual([]);
  });
});

// Bookshelf IDs are external context, never an alternative canonical fact registry.
// These provider-shaped rows exercise the actual owner-filtered context and validators.
function materialReferenceDocument(): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = '英語の勉強で金フレを20語進めたい';
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan', planningWindow: null,
    tasks: [{ localId: 'task-local', existingPublicId: null, category: 'study', title: '英語の勉強',
      study: { purpose: 'self_study', contextLabel: '英語', components: [{
        localId: 'material-local', existingPublicId: 'gold-phrase', parentLocalId: null,
        role: 'material', label: '金フレ', sourceText,
        workloads: [{ localId: 'words-local', quantityRole: 'target', amount: 20,
          unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null, sourceText }],
      }] },
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText,
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function seedMaterialGraph(withMaterial: boolean, label = '金フレ') {
  const document = materialReferenceDocument();
  document.tasks[0].study!.components[0].existingPublicId = null;
  document.tasks[0].study!.components[0].label = label;
  document.tasks[0].study!.components[0].sourceText = `英語の勉強で${label}を20語進めたい`;
  document.tasks[0].study!.components[0].workloads[0].sourceText = `英語の勉強で${label}を20語進めたい`;
  if (!withMaterial) document.tasks[0].study!.components = [];
  const seed = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(), document,
    context: { conversationId: 'material-reference-baseline', turnId: 'seed', expectedRevision: 0 },
  });
  expect(seed.status, seed.errors.join(',')).toBe('applied');
  return seed.graph;
}

describe('registered material admission through the ordinary planning boundary', () => {
  it.each([
    'new_component', 'new_task', 'accepted_parent', 'typed_null', 'canonical_component',
    'foreign_owner', 'archived', 'wrong_label', 'duplicate_component', 'duplicate_task',
    'duplicate_registry', 'existing_material', 'removed_parent', 'duplicate_local_id', 'unrelated_own_source',
  ] as const)('preserves identity and twenty-word conservation: %s', (shape) => {
    const document = materialReferenceDocument();
    const task = document.tasks[0]; const component = task.study!.components[0];
    const hasParent = ['accepted_parent', 'canonical_component', 'existing_material', 'removed_parent', 'unrelated_own_source'].includes(shape);
    const graph = hasParent ? seedMaterialGraph(shape === 'canonical_component' || shape === 'existing_material')
      : createEmptyWeeklyPlanningFactGraphV5();
    if (hasParent) { task.existingPublicId = graph.tasks[0].id; document.planningIntent = 'update_plan'; }
    let materials = [material()];
    if (shape === 'new_task') { task.existingPublicId = materials[0].id; task.title = '金フレ'; component.existingPublicId = null; }
    if (shape === 'typed_null') component.existingPublicId = null;
    if (shape === 'canonical_component') {
      component.existingPublicId = graph.components[0].id;
      materials = [material({ id: graph.components[0].id })];
    }
    if (shape === 'foreign_owner') materials = [material({ userId: 'another-owner' })];
    if (shape === 'archived') materials = [material({ status: 'archived' })];
    if (shape === 'wrong_label') component.label = '別の教材';
    if (shape === 'duplicate_component') task.study!.components.push({ ...structuredClone(component),
      localId: 'material-twin', workloads: [{ ...component.workloads[0], localId: 'words-twin' }] });
    if (shape === 'duplicate_task') {
      task.existingPublicId = materials[0].id; task.title = '金フレ'; component.existingPublicId = null;
      const twin = structuredClone(task); twin.localId = 'task-twin';
      twin.study!.components[0].localId = 'material-twin'; twin.study!.components[0].workloads[0].localId = 'words-twin';
      document.tasks.push(twin);
    }
    if (shape === 'duplicate_registry') materials.push(material());
    if (shape === 'removed_parent') graph.factLifecycles = graph.factLifecycles.map(entry =>
      entry.factId === graph.tasks[0].id ? { ...entry, status: 'removed', terminalRevision: graph.revision } : entry);
    if (shape === 'duplicate_local_id') component.workloads[0].localId = component.localId;
    if (shape === 'unrelated_own_source') component.sourceText = 'ありがとう';
    const userText = '英語の勉強で金フレを20語進めたい。ありがとう';
    const originalGraph = structuredClone(graph); const originalDocument = structuredClone(document);
    const summary = createStableV5SemanticPublicStateSummary({ graph, messages: [], ownerId: OWNER_ID,
      currentDate: '2026-08-29', userText, studyMaterials: materials });
    expect(summary.registeredMaterials).toHaveLength(shape === 'foreign_owner' || shape === 'archived' ? 0 : materials.length);
    // Prove that each rejection below reaches the intended reference boundary,
    // rather than passing because an unrelated schema or source fixture is invalid.
    const duplicateLocalError = 'document.tasks[0].study.components[0].workloads[0].localId:duplicate:material-local';
    const parsed = parseWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5(JSON.stringify(document));
    expect(parsed.errors).toEqual(shape === 'duplicate_local_id' ? [duplicateLocalError] : []);
    if (shape !== 'duplicate_local_id') expect(parsed.document).not.toBeNull();
    expect(validateWeeklyPlanningSemanticEvidenceV5({ document })).toEqual([]);
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({ document, currentUserText: userText,
      publicStateSummary: summary, committedGraph: graph })).toEqual([]);
    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
      currentUserText: userText, publicStateSummary: summary, committedGraph: graph,
    });
    expect(graph).toEqual(originalGraph); expect(document).toEqual(originalDocument);
    const shouldAdmit = ['new_component', 'new_task', 'accepted_parent', 'typed_null', 'canonical_component'].includes(shape);
    if (!shouldAdmit) {
      expect(result.document).toBeNull();
      const componentError = 'document.tasks[0].study.components[0].existingPublicId:unknown-active-component:gold-phrase';
      // Duplicate/foreign/archived/mismatched shelf records deny projection; the
      // ordinary existing-entity validator owns the resulting unknown reference.
      const expectedErrors = shape === 'duplicate_local_id' ? [duplicateLocalError]
        : shape === 'duplicate_task' ? [
          'document.tasks[0].existingPublicId:unknown-active-task:gold-phrase',
          'document.tasks[1].existingPublicId:unknown-active-task:gold-phrase',
        ] : shape === 'duplicate_component' ? [componentError,
          'document.tasks[0].study.components[1].existingPublicId:unknown-active-component:gold-phrase',
        ] : shape === 'removed_parent' ? [
          `document.tasks[0].existingPublicId:unknown-active-task:${graph.tasks[0].id}`, componentError,
        ] : [componentError];
      expect([...result.errors].sort()).toEqual(expectedErrors.sort());
      return;
    }
    expect(result.errors).toEqual([]); expect(result.document).not.toBeNull();
    if (!result.document) throw new Error('admission failed');
    const acceptedTask = result.document.tasks[0]; const acceptedComponent = acceptedTask.study!.components[0];
    expect(acceptedTask.existingPublicId ?? null).toBe(hasParent ? graph.tasks[0].id : null);
    expect(acceptedComponent.existingPublicId ?? null).toBe(shape === 'canonical_component' ? graph.components[0].id : null);
    expect(acceptedComponent.workloads).toEqual(originalDocument.tasks[0].study!.components[0].workloads);
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document: result.document,
      context: { conversationId: 'material-reference-baseline', turnId: `accepted-${shape}`, expectedRevision: graph.revision } });
    expect(canonical.status, canonical.errors.join(',')).toBe('applied');
    const binding = applyWeeklyPlanningExistingEntityBindingsV5({ originalGraph: graph, document: result.document, canonicalization: canonical });
    expect(binding.errors).toEqual([]);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(binding.canonicalization.graph);
    expect(active.tasks).toHaveLength(1); expect(active.components).toHaveLength(1); expect(active.workloads).toHaveLength(1);
    expect(active.workloads[0]).toMatchObject({ taskId: active.tasks[0].id, componentId: active.components[0].id,
      quantityRole: 'target', amount: 20, unitCode: 'word' });
    expect(active.components[0]).toMatchObject({ taskId: active.tasks[0].id, role: 'material', label: '金フレ' });
    if (hasParent) expect(active.tasks[0].id).toBe(graph.tasks[0].id);
    if (shape === 'canonical_component') expect(active.workloads[0].id).toBe(graph.workloads[0].id);
    else expect(active.components[0].id).not.toBe(materials[0].id);
  });

  // A visible external bookshelf identity must survive the pending-answer repair.
  it('keeps a known bookshelf reference out of the unrelated pending component through real normalization', async () => {
    const graph = seedMaterialGraph(true, '旧教材A');
    const document = materialReferenceDocument();
    document.planningIntent = 'update_plan'; document.tasks[0].existingPublicId = graph.tasks[0].id;
    const summary = createStableV5SemanticPublicStateSummary({ graph, messages: [], ownerId: OWNER_ID,
      currentDate: '2026-08-29', userText: '英語の勉強で金フレを20語進めたい', studyMaterials: [material()] });
    summary.pendingQuestion = { questionCode: 'missing_schedulable_work', targetFactId: graph.components[0].id };
    const before = structuredClone(graph);
    const raw = JSON.stringify(document);
    const normalized = normalizePendingQuestionEntityBindingsV5({ rawResponse: raw, publicStateSummary: summary });
    expect(document.tasks[0].study!.components[0].existingPublicId).toBe('gold-phrase');
    expect(summary.registeredMaterials).toEqual([expect.objectContaining({ materialId: 'gold-phrase' })]);
    expect(normalized).toEqual({ rawResponse: raw, repairs: [] });
    const userText = '英語の勉強で金フレを20語進めたい';
    const error = 'document.tasks[0].study.components[0].existingPublicId:unknown-active-component:gold-phrase';
    const validation = validateWeeklyPlanningSemanticResponseV5(raw, {
      currentUserText: userText, publicStateSummary: summary, committedGraph: graph,
    });
    expect(validation.errors).toEqual([error]); expect(validation.document).toBeNull();
    expect(validation.parsedDocument?.tasks[0].study?.components[0]).toMatchObject({
      existingPublicId: 'gold-phrase', label: '金フレ', workloads: [expect.objectContaining({ amount: 20 })],
    });
    const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
      requests.push(structuredClone(request));
      if (requests.length > 2) throw new Error('unexpected extra pending material repair call');
      return raw;
    } };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText,
      publicStateSummary: summary, committedGraph: graph });
    expect(requests.map(request => request.responseFormat?.json_schema.name)).toEqual([
      'weekly_planning_semantic_document_v5', 'weekly_planning_semantic_document_v5',
    ]);
    expect(result.status).toBe('rejected'); expect(result.document).toBeNull();
    expect(result.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
    expect(result.diagnostics.validationErrors).toContain(`initial:${error}`);
    expect(result.diagnostics.validationErrors).toContain(`repair:${error}`);
    expect(graph).toEqual(before); expect(raw).toBe(JSON.stringify(document));
  });
});

describe('registered material identity across a bounded representation repair', () => {
  it.each([true, false])('preserves the original provider identity when the repair repeats it: %s', async (keepReference) => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const userText = '明日、英語の勉強で金フレを20語進めたい';
    const summary = createStableV5SemanticPublicStateSummary({ graph, messages: [], ownerId: OWNER_ID,
      currentDate: '2026-08-29', userText, studyMaterials: [material()] });
    const initial = materialReferenceDocument();
    initial.planningWindow = { localId: 'window', kind: 'relative_day', value: 'tomorrow',
      start: '2026-08-30', end: '2026-08-30', sourceText: '明日' };
    const initialRaw = JSON.stringify(initial);
    const validation = validateWeeklyPlanningSemanticResponseV5(initialRaw, {
      currentUserText: userText, publicStateSummary: summary, committedGraph: graph,
    });
    // This is a parse-stage representation error, not the post-parse absolute-window route.
    expect(validation.errors).toEqual(['document.planningWindow:relative-must-remain-symbolic']);
    expect(validation.parsedDocument?.tasks[0].study!.components[0].existingPublicId).toBe('gold-phrase');
    const repaired = structuredClone(initial);
    repaired.planningWindow!.start = null; repaired.planningWindow!.end = null;
    if (!keepReference) repaired.tasks[0].study!.components[0].existingPublicId = null;
    const responses = [initialRaw, JSON.stringify(repaired)];
    const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
      requests.push(structuredClone(request));
      const response = responses.shift(); if (!response) throw new Error('unexpected additional material repair call');
      return response;
    } };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText, publicStateSummary: summary, committedGraph: graph,
    });
    expect(requests.map(request => request.responseFormat?.json_schema.name)).toEqual([
      'weekly_planning_semantic_document_v5', 'weekly_planning_semantic_document_v5',
    ]);
    expect(result.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
    expect(graph).toEqual(createEmptyWeeklyPlanningFactGraphV5());
    expect(initialRaw).toBe(JSON.stringify(initial));
    if (!keepReference) {
      expect(result.status).toBe('rejected');
      expect(result.diagnostics.validationErrors.some(error => error.includes('semantic-repair-preservation'))).toBe(true);
      return;
    }
    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({ kind: 'relative_day', value: 'tomorrow', start: null, end: null });
    expect(result.document?.tasks[0].study!.components[0]).toMatchObject({ existingPublicId: null, label: '金フレ',
      workloads: [expect.objectContaining({ amount: 20, unitCode: 'word', quantityRole: 'target' })] });
  });
});
