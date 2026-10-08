import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { focusedMaterialContextV5, parseFocusedMaterialDocumentV5, createFocusedMaterialMessagesV5, tryFocusedMaterialAnswerRouteV5 } from './weeklyPlanningFocusedMaterialAnswerV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import { emptyMaterialAnswer } from '../testUtils/weeklyPlanningFocusedMaterialAnswerFixture';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { markWeeklyPlanningSemanticRepairConsumedV5, weeklyPlanningSemanticRepairConsumedV5 } from './weeklyPlanningSemanticRepairLedgerV5';
import { tryFocusedSemanticRepairRouteV5 } from './weeklyPlanningSemanticFocusedRepairRoutesV5';
import { runGenericSemanticRepairRouteV5 } from './weeklyPlanningSemanticGenericRepairRouteV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { tryWeeklyPlanningSemanticNoOpCompletenessRetryV5 } from './weeklyPlanningSemanticNoOpCompletenessRetryV5';
import { tryWeeklyPlanningDenseTurnCompletenessRetryV5 } from './weeklyPlanningSemanticDenseTurnCompletenessV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

function input(): WeeklyPlanningSemanticNormalizerInputV5 {
  const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.revision = 1;
  const source = { conversationId: 'c', turnId: 'setup', semanticLocalId: 'original', sourceText: '数学の問題集を20問', origin: 'user' as const };
  graph.tasks = [{ id: 'private-task-id', category: 'study', title: '数学の問題集', source, createdRevision: 1 }];
  graph.components = [{ id: 'private-component-id', taskId: graph.tasks[0].id, parentComponentId: null, role: 'material', label: '数学の問題集', source, createdRevision: 1 }];
  graph.workloads = [{ id: 'private-workload-id', taskId: graph.tasks[0].id, componentId: graph.components[0].id, quantityRole: 'target', amount: 20,
    unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source, createdRevision: 1 }];
  graph.uncertainties = [{ id: 'need', targetFactId: graph.components[0].id, field: 'material_identity', reason: '教材が未確定', source, createdRevision: 1 }];
  graph.factLifecycles = [graph.tasks[0].id, graph.components[0].id, graph.workloads[0].id, 'need'].map((factId) => ({ factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
  return { userText: '青チャートのこと', committedGraph: graph, conversationArchitecture: 'interaction_v1', publicStateSummary: {
    pendingQuestion: { questionCode: 'semantic_uncertainty', targetFactId: 'need', graphRevision: 1 },
    tasks: graph.tasks.map((fact) => ({ publicId: fact.id, category: fact.category, title: fact.title })),
    components: graph.components.map((fact) => ({ publicId: fact.id, taskPublicId: fact.taskId, parentComponentPublicId: null, role: fact.role, label: fact.label })),
    workloads: graph.workloads.map((fact) => ({ ...fact, publicId: fact.id, taskPublicId: fact.taskId, componentPublicId: fact.componentId })),
    uncertainties: [{ publicId: 'need', targetPublicId: graph.components[0].id, field: 'material_identity', reason: '教材が未確定' }],
    registeredMaterials: [{ materialId: 'private-bookshelf-id', name: '青チャート（架空A）', aliases: ['青チャート'] }],
  } };
}
function scripted(responses: string[]) {
  const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
    requests.push(request); const result = responses[requests.length - 1];
    if (result === undefined) throw new Error('focused material script exhausted');
    return result;
  } };
  return { requests, normalizer: createWeeklyPlanningSemanticNormalizerV5(client) };
}
describe('focused material semantic contract and exact machine targets', () => {
  it('requires an active, unambiguous typed material need; keeps legacy and stale presentations out', () => {
    const value = input();
    expect(focusedMaterialContextV5(value)?.component?.id).toBe('private-component-id');
    expect(focusedMaterialContextV5({ ...value, conversationArchitecture: 'legacy_v5' })).toBeNull();
    expect(focusedMaterialContextV5({ ...value, supplementalContext: 'attachment' })).toBeNull();
    value.publicStateSummary!.pendingQuestion = { questionCode: 'semantic_uncertainty', targetFactId: 'need', graphRevision: 0 };
    expect(focusedMaterialContextV5(value)).toBeNull();
    value.publicStateSummary!.pendingQuestion = null;
    expect(focusedMaterialContextV5(value)?.pendingNeedId).toBe('need');
    value.committedGraph!.uncertainties.push({ ...value.committedGraph!.uncertainties[0], id: 'second' });
    value.committedGraph!.factLifecycles.push({ factId: 'second', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    expect(focusedMaterialContextV5(value)).toBeNull();
  });
  it('binds the live task-level material field while preserving a distinct material_identity kind', () => {
    const value = input();
    value.committedGraph!.components = [];
    value.committedGraph!.uncertainties[0].field = 'material';
    value.committedGraph!.uncertainties[0].targetFactId = value.committedGraph!.tasks[0].id;
    expect(focusedMaterialContextV5(value)).toMatchObject({ component: null, pendingNeedField: 'material' });
    value.committedGraph!.uncertainties[0].field = 'work_breakdown';
    expect(focusedMaterialContextV5(value)).toBeNull();
  });
  it('sends short choices, not public IDs, and refuses an unmentioned catalogue suffix or wrong registered choice', () => {
    const value = input(); const context = focusedMaterialContextV5(value)!;
    const prompt = JSON.stringify(createFocusedMaterialMessagesV5(value, context));
    for (const id of ['private-task-id', 'private-component-id', 'private-workload-id', 'private-bookshelf-id']) expect(prompt).not.toContain(id);
    const answer = emptyMaterialAnswer('material_answer', { label: '青チャート', registeredChoice: 'm1', sourceText: '青チャート' });
    expect(parseFocusedMaterialDocumentV5(JSON.stringify(answer), context).document?.tasks[0].study?.components[0].existingPublicId).toBe('private-component-id');
    expect(parseFocusedMaterialDocumentV5(JSON.stringify({ ...answer, label: '青チャート（架空A）' }), context).errors).toContain('focused-material:label-without-current-source');
    expect(parseFocusedMaterialDocumentV5(JSON.stringify({ ...answer, registeredChoice: 'm999' }), context).document).toBeNull();
  });
  it('creates an exact public-workload rate reference without reasserting an accepted quantity', () => {
    const context = focusedMaterialContextV5(input())!;
    const decision = emptyMaterialAnswer('effort_answer', { workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: '1問3分' });
    const result = parseFocusedMaterialDocumentV5(JSON.stringify(decision), context);
    expect(result.document?.tasks[0].workloads).toEqual([]);
    expect(result.document?.tasks[0].study).toBeNull();
    expect(result.document?.tasks[0].effortEstimates[0]).toMatchObject({ targetLocalId: 'private-workload-id', minutes: 3 });
    expect(parseFocusedMaterialDocumentV5(JSON.stringify({ ...decision, workloadChoice: 'w2' }), context).document).toBeNull();
    expect(parseFocusedMaterialDocumentV5(JSON.stringify({ ...decision, minutes: 0 }), context).document).toBeNull();
  });
  it('performs one semantic repair and permits only an unrepaired generic initial afterward', async () => {
    const script = scripted(['{}', '{}', '{}']); const value = input(); const before = structuredClone(value.committedGraph);
    const result = await script.normalizer.normalize(value);
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(script.requests).toHaveLength(3);
    expect(script.requests.slice(0, 2).every((request) => request.responseFormat?.json_schema.name === 'weekly_planning_focused_material_answer_v5')).toBe(true);
    expect(script.requests[2].responseFormat?.json_schema.name).toBe('weekly_planning_semantic_document_v5');
    expect(value.committedGraph).toEqual(before);
  });
  it('repairs a bad choice once and validates current-turn provenance instead of adopting bookshelf context after thanks', async () => {
    const answer = emptyMaterialAnswer('material_answer', { label: '青チャート', sourceText: '青チャート' });
    const script = scripted([JSON.stringify({ ...answer, registeredChoice: 'wrong' }), JSON.stringify(answer)]);
    const repaired = await script.normalizer.normalize(input());
    expect(repaired.status, JSON.stringify(repaired.diagnostics)).toBe('accepted'); expect(repaired.diagnostics.repairAttempted).toBe(true);
    expect(script.requests).toHaveLength(2);
    const genericAnswer = parseFocusedMaterialDocumentV5(JSON.stringify(answer), focusedMaterialContextV5(input())!).document;
    const ungrounded = scripted([JSON.stringify(answer), JSON.stringify(answer), JSON.stringify(genericAnswer)]);
    const result = await ungrounded.normalizer.normalize({ ...input(), userText: 'ありがとう' });
    expect(result.status).toBe('rejected'); expect(ungrounded.requests).toHaveLength(3);
    expect(result.diagnostics.validationErrors.some((error) => error.includes('not-grounded-in-current-user-text'))).toBe(true);
  });
});


// Exercise actual dispatch boundaries with a run that has already spent its repair.
// The positive controls prove the date/window/scope fixtures reach those routes.
function ledgerRun(value: WeeklyPlanningSemanticNormalizerInputV5, response: string) {
  const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  const client: OpenAiCompatibleClient = { semanticCensusEnabled: true, async createChatCompletion(request) {
    requests.push(request);
    return response;
  } };
  return { run: new WeeklyPlanningSemanticNormalizerRunV5(client, value), requests };
}

function emptyLedgerDocument(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [] };
}

describe('shared interaction repair ledger dispatch boundaries', () => {
  it('keeps consumption local to an interaction run and leaves legacy retries unchanged', () => {
    const first = ledgerRun(input(), '{}').run;
    const second = ledgerRun(input(), '{}').run;
    const legacy = ledgerRun({ ...input(), conversationArchitecture: 'legacy_v5' }, '{}').run;
    markWeeklyPlanningSemanticRepairConsumedV5(first);
    markWeeklyPlanningSemanticRepairConsumedV5(legacy);
    expect(weeklyPlanningSemanticRepairConsumedV5(first)).toBe(true);
    expect(weeklyPlanningSemanticRepairConsumedV5(second)).toBe(false);
    expect(weeklyPlanningSemanticRepairConsumedV5(legacy)).toBe(false);
  });

  it('refuses a second generic repair at the shared dispatch boundary', async () => {
    const { run, requests } = ledgerRun(input(), '{}');
    const initialValidation = validateWeeklyPlanningSemanticResponseV5('{}', { conversationArchitecture: 'interaction_v1' });
    const params = { run, baseMessages: [], initialResponse: '{}', initialValidation };
    expect((await runGenericSemanticRepairRouteV5(params)).status).toBe('rejected');
    expect(requests).toHaveLength(1);
    expect(requests[0].semanticCensusStage).toBe('repair');
    expect(weeklyPlanningSemanticRepairConsumedV5(run)).toBe(true);
    const refused = await runGenericSemanticRepairRouteV5(params);
    expect(refused.status).toBe('rejected');
    expect(refused.document).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it.each(['date', 'window', 'scope'] as const)('refuses a second focused %s repair after proving its eligibility', async (kind) => {
    const document = emptyLedgerDocument();
    const value: WeeklyPlanningSemanticNormalizerInputV5 = { userText: '数学。2週間後に模試。8月17日から23日。火曜18時から20時は予定',
      conversationArchitecture: 'interaction_v1', publicStateSummary: { calendarContext: { currentDate: '2026-08-12', timeZone: 'Asia/Tokyo' } } };
    let reply: string;
    let schema: string;
    if (kind === 'date') {
      document.userContextFacts = [{ localId: 'exam', kind: 'goal_event', label: '模試', value: null, dateExpression: '2週間後', sourceText: '2週間後に模試' }];
      reply = JSON.stringify({ dateExpression: '2026-08-26' });
      schema = 'weekly_planning_focused_user_context_date_repair_v5';
    } else if (kind === 'window') {
      document.planningWindow = { localId: 'window', kind: 'absolute', value: '8月17日から23日', start: null, end: null, sourceText: '8月17日から23日' };
      reply = JSON.stringify({ value: '2026-08-17/2026-08-23', start: '2026-08-17', end: '2026-08-23' });
      schema = 'weekly_planning_focused_planning_window_repair_v5';
    } else {
      document.tasks = [{ localId: 'task', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学',
        study: { purpose: 'self_study', contextLabel: null, components: [] },
        workloads: [], effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: '数学', temporalConstraints: [{ localId: 'busy',
          targetLocalId: 'task', kind: 'excluded_date', constraintLevel: 'hard', dateExpression: 'weekday:tuesday', namedTimePeriod: null,
          startTime: '18:00', endTime: '20:00', precision: 'exact', sourceText: '火曜18時から20時は予定' }] }];
      reply = JSON.stringify({ decision: 'plan_unavailable' });
      schema = 'weekly_planning_focused_temporal_scope_repair_v5';
    }
    const initialResponse = JSON.stringify(document);
    const initialValidation = validateWeeklyPlanningSemanticResponseV5(initialResponse, { currentUserText: value.userText,
      publicStateSummary: value.publicStateSummary, conversationArchitecture: 'interaction_v1' });
    expect(initialValidation.document).toBeNull();
    const { run, requests } = ledgerRun(value, reply);
    const params = { run, initialResponse, initialValidation };
    expect(await tryFocusedSemanticRepairRouteV5(params), JSON.stringify(initialValidation.errors)).not.toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0].responseFormat?.json_schema.name).toBe(schema);
    expect(requests[0].semanticCensusStage).toBe('repair');
    expect(weeklyPlanningSemanticRepairConsumedV5(run)).toBe(true);
    const refused = await tryFocusedSemanticRepairRouteV5(params);
    expect(refused?.status).toBe('rejected');
    expect(refused?.document).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('allows a focused material initial but refuses its repair when the ledger is already consumed', async () => {
    const value = input();
    const before = structuredClone(value.committedGraph);
    const { run, requests } = ledgerRun(value, '{}');
    markWeeklyPlanningSemanticRepairConsumedV5(run);
    expect(await tryFocusedMaterialAnswerRouteV5(run)).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0].semanticCensusStage).toBe('focused');
    expect(value.committedGraph).toEqual(before);
  });

  it('refuses a focused material repair after an actual generic repair consumed the same run', async () => {
    const { run, requests } = ledgerRun(input(), '{}');
    const initialValidation = validateWeeklyPlanningSemanticResponseV5('{}', { conversationArchitecture: 'interaction_v1' });
    await runGenericSemanticRepairRouteV5({ run, baseMessages: [], initialResponse: '{}', initialValidation });
    expect(weeklyPlanningSemanticRepairConsumedV5(run)).toBe(true);
    expect(await tryFocusedMaterialAnswerRouteV5(run)).toBeNull();
    expect(requests.map(request => request.semanticCensusStage)).toEqual(['repair', 'focused']);
  });

  it.each([false, true])('refuses a second repair at the invalid completeness audit reread boundary (dense=%s)', async (dense) => {
    const value = input();
    value.userText = '青チャートです。1問3分くらい' + (dense ? 'のこと'.repeat(200) : '');
    const before = structuredClone(value.committedGraph);
    const parsed = parseFocusedMaterialDocumentV5(JSON.stringify(emptyMaterialAnswer('material_answer', {
      label: '青チャート', sourceText: '青チャート',
    })), focusedMaterialContextV5(value)!);
    const initialResponse = JSON.stringify(parsed.document);
    const validation = validateWeeklyPlanningSemanticResponseV5(initialResponse, { currentUserText: value.userText,
      committedGraph: value.committedGraph, publicStateSummary: value.publicStateSummary, conversationArchitecture: 'interaction_v1' });
    expect(validation.document).not.toBeNull();
    const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const client: OpenAiCompatibleClient = { semanticCensusEnabled: true, async createChatCompletion(request) {
      requests.push(request);
      return request.responseFormat?.json_schema.name === 'weekly_planning_dense_turn_completeness_audit_v5'
        ? JSON.stringify({ decision: 'incomplete', missingFacts: ['current per-unit pace'] }) : '{}';
    } };
    const run = new WeeklyPlanningSemanticNormalizerRunV5(client, value);
    markWeeklyPlanningSemanticRepairConsumedV5(run);
    const result = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({ run, baseMessages: [], initialResponse,
      initialDocument: validation.document!, semanticRepairConsumed: () => weeklyPlanningSemanticRepairConsumedV5(run) });
    expect(result?.status).toBe('accepted');
    expect(result?.document).toEqual(validation.document);
    expect(result?.completenessAbstention).toEqual({ reason: 'repair_budget_consumed' });
    expect(result?.diagnostics.repairAttempted).toBe(true);
    expect(requests.map(request => request.semanticCensusStage)).toEqual(['audit', 'retry']);
    expect(weeklyPlanningSemanticRepairConsumedV5(run)).toBe(true);
    expect(value.committedGraph).toEqual(before);
  });

  it('never adds a repair during invalid no-op completeness rereads after the ledger is consumed', async () => {
    const value = input();
    const initialDocument = emptyLedgerDocument();
    const before = structuredClone(value.committedGraph);
    const { run, requests } = ledgerRun(value, '{}');
    markWeeklyPlanningSemanticRepairConsumedV5(run);
    const result = await tryWeeklyPlanningSemanticNoOpCompletenessRetryV5({ run, baseMessages: [],
      initialResponse: JSON.stringify(initialDocument), initialDocument, repairAttempted: true });
    expect(result?.status).toBe('accepted');
    expect(result?.document).toEqual(initialDocument);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter(request => request.semanticCensusStage === 'repair')).toHaveLength(0);
    expect(weeklyPlanningSemanticRepairConsumedV5(run)).toBe(true);
    expect(value.committedGraph).toEqual(before);
  });
});
