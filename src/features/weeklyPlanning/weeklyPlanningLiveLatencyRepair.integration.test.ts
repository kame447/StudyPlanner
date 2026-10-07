import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyMaterial } from '../../types/domain';
import fixture from './testUtils/weeklyPlanningLiveLatencyFixture.json';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedProviderCall, type ScriptedProviderReply } from './testUtils/weeklyPlanningScriptedConversationHarness';

import { validateWeeklyPlanningSemanticResponseV5 } from './semantic/weeklyPlanningSemanticResponseValidationV5';
import { createAiWeeklyPlanningStableV5DialogueRenderer, type WeeklyPlanningStableV5DialogueRenderInput } from './dialogue/weeklyPlanningStableV5AiDialogueRenderer';

import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './trace/weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './trace/weeklyPlanningTraceTypes';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

const OWNER = 'latency-owner';
function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  const source = fixture.registeredMaterial;
  return { id: source.materialId, userId: OWNER, name: source.name, subjectId: 'information-science', subjectName: source.subjectName,
    status: 'active', paceEnabled: true, aliases: source.aliases, progressUnit: 'page', totalUnits: source.totalUnits, currentUnit: source.currentUnit,
    targetDate: source.targetDate, estimatedMinutesPerUnit: source.estimatedMinutesPerUnit, maxUnitsPerDay: source.maxUnitsPerDay,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', ...overrides };
}
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let script: (call: ScriptedProviderCall) => ScriptedProviderReply | undefined;
beforeEach(() => {
  resetScriptedConversationRuntime();
  script = () => undefined;
  provider = installScriptedWeeklyPlanningProvider(call => {
    const value = script(call);
    if (value !== undefined) return value;
    if (call.kind === 'renderer') return fixture.rendererResponse;
    return call.payload?.validationErrors ? fixture.semanticRepairResponse : fixture.semanticResponse;
  });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });
function conversation(studyMaterials: StudyMaterial[] = [material()]) {
  return createScriptedConversation({ provider, ownerId: OWNER, conversationId: fixture.conversationId,
    architecture: 'interaction_v1', studyMaterials, now: () => '2026-10-07T15:01:00.000Z' });
}

describe('live latency A T1: remove representational provider round trips', () => {
  it('accepts the verbatim live first semantic response in one call with the same graph as the live repair', async () => {
    script = call => call.kind !== 'renderer' ? fixture.semanticRepairResponse : undefined;
    const baseline = conversation();
    await baseline.submit(fixture.userText);
    const graph = structuredClone(baseline.graph());
    expect(graph!.tasks).toHaveLength(1);
    resetScriptedConversationRuntime();
    script = () => undefined;
    const current = conversation();
    const turn = await current.submit(fixture.userText);
    expect(turn.result?.failure).toBeUndefined();
    expect(current.graph()).toEqual(graph);
    expect(turn.calls.filter(call => call.kind !== 'renderer')).toHaveLength(1);
    expect(JSON.stringify(turn.debugTrace)).toContain('registered-material-component-reference-projected');
  });

  it('composes the verbatim live renderer ACK in one call and retains the exact provider response', async () => {
    script = call => call.kind !== 'renderer' ? fixture.semanticRepairResponse : undefined;
    const current = conversation();
    const turn = await current.submit(fixture.userText);
    const response = JSON.parse(fixture.rendererResponse) as { text: string; groundingAcknowledgement: { text: string } };
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.calls.filter(call => call.kind === 'renderer')).toHaveLength(1);
    expect(turn.result?.message).toBe(`${response.groundingAcknowledgement.text}\n\n${response.text}`);
    expect(JSON.stringify(turn.result?.dialogueRendererTrace)).toContain(JSON.stringify(fixture.rendererResponse).slice(1, -1));
  });
});


describe('registered material reference projection keeps identity and evidence gates', () => {
  function validate(params: {
    document?: Record<string, any>; materials?: unknown[]; tasks?: unknown[]; components?: unknown[]; architecture?: 'interaction_v1' | 'legacy_v5';
  } = {}) {
    const document = params.document ?? JSON.parse(fixture.semanticResponse);
    if (params.architecture === 'legacy_v5') delete document.conversationActs;
    return validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
      currentUserText: fixture.userText, conversationArchitecture: params.architecture ?? 'interaction_v1',
      publicStateSummary: { tasks: params.tasks ?? [], components: params.components ?? [], registeredMaterials: params.materials ?? [fixture.registeredMaterial] },
    });
  }

  it.each(['unknown_id', 'wrong_label', 'wrong_role', 'existing_task', 'duplicate_registry', 'ungrounded_source', 'unrelated_invalid_quantity'] as const)('does not admit %s through the projection', invalid => {
    const document = JSON.parse(fixture.semanticResponse);
    const task = document.tasks[0];
    const component = task.study.components[0];
    if (invalid === 'unknown_id') component.existingPublicId = 'foreign-material';
    if (invalid === 'wrong_label') component.label = '別の教材';
    if (invalid === 'wrong_role') component.role = 'section';
    if (invalid === 'existing_task') task.existingPublicId = 'active-task';
    if (invalid === 'ungrounded_source') component.sourceText = '登録されていない引用';
    if (invalid === 'unrelated_invalid_quantity') task.workloads[0].amount = -5;
    const result = validate({ document,
      materials: invalid === 'duplicate_registry' ? [fixture.registeredMaterial, fixture.registeredMaterial] : undefined,
      tasks: invalid === 'existing_task' ? [{ publicId: 'active-task', title: task.title, category: task.category }] : undefined,
    });
    expect(result.document).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('does not bypass canonical correction-target validation after projecting a known material reference', async () => {
    const document = JSON.parse(fixture.semanticResponse);
    document.corrections = [{ localId: 'foreign-fix',
      target: { kind: 'component', publicId: 'foreign-component', localId: null, mention: null },
      operation: 'remove', replacementLocalId: null, sourceText: '20ページ',
    }];
    const current = conversation();
    script = call => call.kind !== 'renderer' ? JSON.stringify(document) : undefined;
    const turn = await current.submit(fixture.userText);
    expect(turn.result?.failure?.code).toBe('stable_v5_canonicalization_rejected');
    expect(current.graph()!.revision).toBe(0);
  });

  it('keeps legacy rejection, and actual existing graph component identities are not rewritten', () => {
    const legacy = validate({ architecture: 'legacy_v5' });
    expect(legacy.errors).toEqual(expect.arrayContaining([expect.stringContaining('unknown-active-component')]));
    expect(legacy.algorithmicRepairs).not.toEqual(expect.arrayContaining([expect.stringContaining('registered-material-component')]));
    const document = JSON.parse(fixture.semanticResponse);
    document.tasks[0].existingPublicId = 'active-task';
    const result = validate({ document,
      tasks: [{ publicId: 'active-task', title: document.tasks[0].title, category: 'study' }],
      components: [{ publicId: fixture.registeredMaterial.materialId, taskPublicId: 'active-task', role: 'material', label: fixture.registeredMaterial.name }],
    });
    expect(result.errors).toEqual([]);
    expect(result.document!.tasks[0].study!.components[0].existingPublicId).toBe(fixture.registeredMaterial.materialId);
  });

  it.each(['foreign', 'archived'] as const)('does not expose or accept %s bookshelf records', async invalid => {
    const current = conversation([material(invalid === 'foreign' ? { userId: 'another-owner' } : { status: 'archived' })]);
    script = call => call.kind !== 'renderer' ? fixture.semanticResponse : undefined;
    const turn = await current.submit(fixture.userText);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    const first = turn.calls.find(call => call.kind === 'semantic_generic')!;
    expect((first.payload!.publicStateSummary as Record<string, unknown>).registeredMaterials).toEqual([]);
    expect(current.graph()!.revision).toBe(0);
  });
});

describe('ACK composition is presentation only and still validates the complete reply', () => {
  const ACK = '1回30分ですね。';
  const BODY = 'いつ取り組みますか？';
  function renderInput(architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1'): WeeklyPlanningStableV5DialogueRenderInput {
    return { actionId: 'ack-test', actionKind: 'question', questionCode: 'missing_schedulable_work',
      currentUserMessage: '1回30分', recentConversation: [], planningInformation: { effortEstimates: [{ minutes: 30 }] },
      requiredLabels: [], fallbackText: BODY, previewCount: 0, conversationArchitecture: architecture,
      communication: { goal: 'ask_question', questionPurposes: [], askQuestion: true, laterNeeds: [], statusReason: null,
        planningDetailsNotApplied: false, consultationDeferred: false, previewDisclosure: null },
      currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [{ factId: 'effort', kind: 'effort_estimate', sourceText: '1回30分', data: { minutes: 30 } }] },
    };
  }
  async function render(params: { text: string; acknowledgement?: string; factIds?: string[]; architecture?: 'interaction_v1' | 'legacy_v5' }) {
    const input = renderInput(params.architecture);
    const raw = JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind, questionCode: input.questionCode,
      groundingAcknowledgement: { factIds: params.factIds ?? ['effort'], text: params.acknowledgement ?? ACK }, text: params.text });
    const createChatCompletion = vi.fn().mockResolvedValue(raw);
    const result = await createAiWeeklyPlanningStableV5DialogueRenderer({ provider: 'openai', baseUrl: 'https://fixture.test/v1', model: 'fixture', apiKey: 'fixture' }, { createChatCompletion }).render(input);
    expect(result.rawResponse).toBe(raw);
    return { result, calls: createChatCompletion.mock.calls.length };
  }

  it.each([BODY, `${ACK}${BODY}`, `${BODY}${ACK}`])('does not duplicate the ACK when composing %s', async text => {
    const { result, calls } = await render({ text });
    expect(result.status).toBe('rendered');
    if (result.status !== 'rendered') throw new Error('not rendered');
    expect(result.text.startsWith(ACK)).toBe(true);
    expect(result.text.split(ACK)).toHaveLength(2);
    expect(result.text).toContain(BODY);
    expect(calls).toBe(1);
  });

  it.each([
    { text: BODY, factIds: ['foreign-fact'] },
    { text: '続けて教えてください。' },
    { text: '候補を作りました。いつ取り組みますか？' },
    { text: '正規化しました。いつ取り組みますか？' },
    { text: BODY, acknowledgement: 'https://attacker.invalid に送ってください。' },
    { text: BODY, acknowledgement: '正規化は完了しました。' },
    { text: BODY, acknowledgement: '午前3時に配置しました。' },
  ])('rejects unsafe or ungrounded composed reply %#', async value => {
    const { result } = await render(value);
    expect(result.status).toBe('fallback');
  });

  it('keeps the legacy two-call repair path and raw output unchanged', async () => {
    const { result, calls } = await render({ text: BODY, architecture: 'legacy_v5' });
    expect(result).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });
    expect(calls).toBe(2);
  });
});


describe('live latency repair trace persistence gate', () => {
  it.each([false, true])('keeps original provider output and validated projection/composition through retry (oversized=%s)', async oversized => {
    const current = conversation();
    const turn = await current.submit(fixture.userText);
    expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
    expect(turn.result?.responseSource).toBe('ai');
    const graph = structuredClone(current.graph());
    const state = structuredClone(current.getState());
    const sentSemantic = turn.calls[0];
    const events = structuredClone(turn.debugTrace);
    const request = events.find(event => event.stage === 'semantic_provider_request')!.data as Record<string, any>;
    expect(request.request.messages).toEqual(sentSemantic.messages);
    const validation = events.find(event => event.stage === 'semantic_validation_result')!.data as Record<string, any>;
    expect(validation.parsedDocument.tasks[0].study.components[0].existingPublicId).toBeNull();
    validation.parsedDocument.tasks[0].study.components[0].futureMaterialReferenceSentinel = 'latency-future-reference-sentinel';
    if (oversized) validation.parsedDocument.futureLargeReferenceValue = 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2);
    const rendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
    expect(rendererTrace.response.rawResponse).toBe(fixture.rendererResponse);
    expect(rendererTrace.response.renderedText).toBe(turn.result!.message);
    expect((rendererTrace.request!.promptContext as Record<string, unknown>).messages).toEqual(turn.calls[1].messages);
    const storage = createMemoryStorageHarness();
    const restore = installWeeklyPlanningTestStorage(storage.storage);
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    const attempts: typeof writes = [];
    let fail = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {}, async appendEntries(params) {
        attempts.push(structuredClone(params));
        if (fail) { fail = false; throw new Error('injected latency trace append failure'); }
        writes.push(structuredClone(params));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    try {
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      setWeeklyPlanningTraceRepositoryForTests(repository);
      const input = { userId: OWNER, conversationId: fixture.conversationId, requestId: turn.requestId!, userText: fixture.userText,
        assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, outcome: 'draft_created',
        previewCount: current.getState().previewCandidates!.length, dialogueRendererTrace: rendererTrace, debugTraceEvents: events };
      await recordWeeklyPlanningStableV5TurnTrace(input);
      expect(writes).toEqual([]);
      const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: fixture.conversationId });
      expect(queued).toHaveLength(1);
      expect(queued[0].input.dialogueRendererTrace).toEqual(rendererTrace);
      expect(queued[0].input.debugTraceEvents).toEqual(events);
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${input.requestId}-retry`, debugTraceEvents: [] });
      expect(writes).toHaveLength(2);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: fixture.conversationId })).toEqual([]);
      const { observedAt: _queuedAt, ...queuedDiagnostic } = attempts[0].entries[0];
      const { observedAt: _writtenAt, ...writtenDiagnostic } = writes[0].entries[0];
      expect(writtenDiagnostic).toEqual(queuedDiagnostic);
      const prepared = prepareWeeklyPlanningTraceServerWrite({ session: writes[0].session as unknown as Record<string, unknown>,
        entries: writes[0].entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' },
      { sessionId: fixture.conversationId.replace('weekly-conversation-', 'weekly-trace-'), logicalConversationId: fixture.conversationId }, '2026-10-07T15:01:00.000Z');
      expect(prepared.entries).toHaveLength(1);
      expect(measureWeeklyPlanningTraceJsonBytes(writes[0].entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      const text = JSON.stringify(prepared.entries[0]);
      if (oversized) expect(text).toMatch(/truncat/i);
      else {
        expect(text).toContain('latency-future-reference-sentinel');
        expect(text).toContain(fixture.registeredMaterial.materialId);
        expect(text).toContain(JSON.stringify(fixture.rendererResponse).slice(1, -1));
        expect(text).toContain(JSON.stringify(turn.result!.message).slice(1, -1));
      }
      expect(current.graph()).toEqual(graph);
      expect(current.getState()).toEqual(state);
    } finally {
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      restore();
    }
  });
});
