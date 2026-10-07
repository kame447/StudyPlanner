import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyWeeklyPlanningApprovalAvailability } from './application/weeklyPlanningApprovalAvailability';
import { hydrateWeeklyPlanningStableV5RuntimeSession } from './application/weeklyPlanningStableV5RuntimeSession';
import { largestWeeklyPlanningStableV5Checkpoint, parseWeeklyPlanningStableV5PersistedSession, prepareWeeklyPlanningStableV5Checkpoint } from './application/weeklyPlanningStableV5SessionCodec';
import { createWeeklyDraftBlocksFromPreviewCandidates } from './preview/weeklyPlanningPreviewBlocks';
import { createDeferred, createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime, scriptedRendererReply,
  type ScriptedConversation, type ScriptedProviderCall, type ScriptedProviderReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './trace/weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './trace/weeklyPlanningTraceTypes';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

type Json = Record<string, unknown>;
const SETUP = '来週、アルゴリズムの本を30ページ読みたい。1ページ4分。予定を作って';
const CONSTRAINT = '夜20時から22時にして、金曜日までに終わらせたい';
const CORRECTION = 'やっぱり20ページにして';

function document(overrides: Json = {}): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...overrides,
  };
}
function pages(amount: number, sourceText: string): Json {
  return { localId: 'pages', quantityRole: 'target', amount, unitCode: 'page', unitLabel: 'ページ',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText };
}
function task(overrides: Json = {}): Json {
  return { localId: 'book', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: 'アルゴリズムの本',
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
    sourceText: SETUP, ...overrides };
}
function setup(): Json {
  return document({ planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [task({ workloads: [pages(30, '30ページ')], effortEstimates: [{
      localId: 'rate', targetLocalId: 'pages', kind: 'duration_per_unit', minutes: 4, unitCode: 'page',
      precision: 'exact', sourceText: '1ページ4分',
    }] })] });
}
function fact(call: ScriptedProviderCall, collection: string): Json {
  return ((call.payload?.publicStateSummary as Json)[collection] as Json[])[0];
}
function constraints(call: ScriptedProviderCall, unresolved: boolean): Json {
  return document({ planningIntent: 'update_plan', tasks: [task({
    existingPublicId: fact(call, 'tasks').publicId, sourceText: CONSTRAINT,
    temporalConstraints: [
      { localId: 'night', targetLocalId: 'book', kind: 'preferred_window', constraintLevel: 'hard',
        dateExpression: null, namedTimePeriod: null, startTime: '20:00', endTime: '22:00', precision: 'exact', sourceText: '夜20時から22時' },
      { localId: 'deadline', targetLocalId: 'book', kind: 'deadline', constraintLevel: 'hard',
        dateExpression: unresolved ? 'custom:Friday of the intended week' : '2026-10-16', namedTimePeriod: null,
        startTime: null, endTime: null, precision: 'exact', sourceText: '金曜日までに終わらせたい' },
    ],
  })] });
}
function correction(call: ScriptedProviderCall): Json {
  return document({ planningIntent: 'update_plan', tasks: [task({
    existingPublicId: fact(call, 'tasks').publicId, sourceText: CORRECTION, workloads: [pages(20, '20ページにして')],
  })], corrections: [{ localId: 'fix',
    target: { kind: 'workload', publicId: fact(call, 'workloads').publicId, localId: null, mention: '30ページ' },
    operation: 'replace', replacementLocalId: 'pages', sourceText: CORRECTION,
  }] });
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let script: (call: ScriptedProviderCall) => ScriptedProviderReply | Promise<ScriptedProviderReply> | undefined;
beforeEach(() => {
  resetScriptedConversationRuntime();
  script = () => undefined;
  provider = installScriptedWeeklyPlanningProvider(call => {
    const reply = script(call);
    if (reply !== undefined) return reply;
    if (call.kind === 'renderer') return scriptedRendererReply(call, '内容を確認してください。');
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    const output = call.payload?.userText === SETUP ? setup() : document({ conversationActs: [{ kind: 'topic_shift', targetPublicId: null }] });
    if (!call.schemaProperties.includes('conversationActs')) delete output.conversationActs;
    return JSON.stringify(output);
  });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

function blocks(conversation: ScriptedConversation) {
  return createWeeklyDraftBlocksFromPreviewCandidates({ candidates: conversation.getState().previewCandidates ?? [],
    userId: conversation.ownerId, createdAt: '2026-10-07T09:00:00.000Z' });
}
function assertCurrentPreview(conversation: ScriptedConversation) {
  const candidates = conversation.getState().previewCandidates!;
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates).toEqual(candidates.map(() => expect.objectContaining({
    stableV5Metadata: expect.objectContaining({ graphRevision: conversation.graph()!.revision }),
  })));
  expect(classifyWeeklyPlanningApprovalAvailability({ blocks: blocks(conversation), userId: conversation.ownerId })).toMatchObject({ kind: 'eligible' });
}
function reload(conversation: ScriptedConversation): ScriptedConversation {
  const input = { ownerId: conversation.ownerId, weekStartDate: conversation.weekStartDate, conversationId: conversation.conversationId,
    graph: conversation.graph()!, planningState: conversation.getState() };
  const prepared = prepareWeeklyPlanningStableV5Checkpoint(input);
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') throw new Error('invalid checkpoint');
  const persisted = largestWeeklyPlanningStableV5Checkpoint({ ...input, planningState: prepared.planningState, savedAt: '2026-10-07T10:00:00.000Z' });
  expect(persisted).not.toBeNull();
  const restored = parseWeeklyPlanningStableV5PersistedSession({ raw: persisted!.raw, ownerId: input.ownerId, weekStartDate: input.weekStartDate });
  expect(restored).not.toBeNull();
  expect(restored!.graph).toEqual(input.graph);
  expect(restored!.planningState.previewCandidates).toEqual(input.planningState.previewCandidates);
  resetScriptedConversationRuntime();
  hydrateWeeklyPlanningStableV5RuntimeSession({ ...input, graph: restored!.graph });
  return createScriptedConversation({ provider, ownerId: input.ownerId, conversationId: input.conversationId,
    weekStartDate: input.weekStartDate, initialState: restored!.planningState });
}

describe('preview authority across post-E2E conversation changes', () => {
  it('hides the old morning preview when new night/deadline facts are accepted but the deadline needs clarification', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    assertCurrentPreview(conversation);
    const old = blocks(conversation);
    const revision = conversation.graph()!.revision;
    script = call => call.kind === 'semantic_generic' ? JSON.stringify(constraints(call, true)) : undefined;
    const changed = await conversation.submit(CONSTRAINT);
    expect(changed.result?.failure).toBeUndefined();
    expect(conversation.graph()!.revision).toBeGreaterThan(revision);
    expect(conversation.graph()!.temporalConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ startTime: '20:00', endTime: '22:00' }),
    ]));
    expect(changed.result?.state.questions.length).toBeGreaterThan(0);
    expect(changed.result?.draftCandidates).toEqual([]);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: old, userId: conversation.ownerId })).toMatchObject({ kind: 'recompute_required' });
    expect(conversation.getState().previewCandidates).toEqual([]);
    expect(reload(conversation).getState().previewCandidates).toEqual([]);
  });

  it.each(['preferred_window', 'unavailable', 'session_duration'] as const)('hides old work after adding %s while independent work needs an effort answer', async kind => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const old = blocks(conversation);
    const revision = conversation.graph()!.revision;
    const text = `${CONSTRAINT}。英単語80語も追加したい。月曜9時から11時は勉強できない。1回30分に分けたい`;
    script = call => {
      if (call.kind !== 'semantic_generic') return undefined;
      const change = constraints(call, false);
      const boundTask = (change.tasks as Json[])[0];
      boundTask.temporalConstraints = kind === 'preferred_window' ? [(boundTask.temporalConstraints as Json[])[0]] : [];
      if (kind === 'session_duration') boundTask.effortEstimates = [{
        localId: 'session', targetLocalId: 'book', kind: 'session_duration', minutes: 30, unitCode: null, precision: 'exact', sourceText: '1回30分に分けたい',
      }];
      change.tasks = [boundTask, task({ localId: 'words', title: '英単語', sourceText: '英単語80語も追加したい',
        workloads: [{ ...pages(80, '英単語80語'), localId: 'words-work', unitCode: 'word', unitLabel: '語' }],
      })];
      if (kind === 'unavailable') change.availabilityDeclarations = [{
        localId: 'unavailable', kind: 'unavailable', dateExpression: 'weekday:monday', namedTimePeriod: null,
        startTime: '09:00', endTime: '11:00', recurrenceKind: null, days: [], constraintLevel: 'hard',
        capacityMinutes: null, sourceText: '月曜9時から11時は勉強できない',
      }];
      return JSON.stringify(change);
    };
    const changed = await conversation.submit(text);
    expect(changed.result?.failure).toBeUndefined();
    expect(conversation.graph()!.revision).toBeGreaterThan(revision);
    expect(changed.result?.state.questions.length).toBeGreaterThan(0);
    expect(changed.result?.draftCandidates).toEqual([]);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: old, userId: conversation.ownerId })).toMatchObject({ kind: 'recompute_required' });
    expect(conversation.getState().previewCandidates).toEqual([]);
    expect(reload(conversation).getState().previewCandidates).toEqual([]);
  });

  it.each(['malformed', 'network'] as const)('commits a corrected preview even when rendering fails (%s), then reloads the same authority', async failure => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const old = blocks(conversation);
    const revision = conversation.graph()!.revision;
    script = call => {
      if (call.kind === 'semantic_generic') return JSON.stringify(correction(call));
      if (call.kind === 'renderer') return failure === 'network' ? { failure: 'network' } : 'invalid renderer JSON';
      return undefined;
    };
    const changed = await conversation.submit(CORRECTION);
    expect(changed.result?.failure).toBeUndefined();
    expect(changed.result?.responseSource).toBe('deterministic_fallback');
    expect(changed.result?.message.length).toBeGreaterThan(0);
    expect(conversation.graph()!.revision).toBeGreaterThan(revision);
    assertCurrentPreview(conversation);
    const active = new Set(conversation.graph()!.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(conversation.graph()!.workloads.filter(entry => active.has(entry.id)).map(entry => entry.amount)).toEqual([20]);
    expect(conversation.getState().previewCandidates!.some(candidate => candidate.title.includes('30ページ'))).toBe(false);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: old, userId: conversation.ownerId })).toMatchObject({ kind: 'recompute_required' });
    expect((changed.calls.find(call => call.kind === 'renderer')!.payload!.applicationDecision as Json)).toMatchObject({
      actionKind: 'preview_ready', previewCount: conversation.getState().previewCandidates!.length,
      communication: { goal: 'present_preview' },
    });
    assertCurrentPreview(reload(conversation));
  });

  it('regenerates under accepted night constraints, and aside plus reload do not change that preview or its revision', async () => {
    let conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const old = blocks(conversation);
    script = call => call.kind === 'semantic_generic' ? JSON.stringify(constraints(call, false)) : undefined;
    const changed = await conversation.submit(CONSTRAINT);
    expect(changed.result?.failure).toBeUndefined();
    assertCurrentPreview(conversation);
    expect(conversation.getState().previewCandidates!.every(candidate => candidate.startTime >= '20:00' && candidate.endTime <= '22:00')).toBe(true);
    const preview = structuredClone(conversation.getState().previewCandidates);
    const graph = structuredClone(conversation.graph())!;
    script = () => undefined;
    const aside = await conversation.submit('ちょっと待って');
    expect(aside.result?.failure).toBeUndefined();
    expect(aside.result?.draftCandidates).toEqual([]);
    expect(aside.result?.preserveExistingPreview).toBe(true);
    expect(conversation.graph()!.revision).toBe(graph.revision);
    expect({ ...conversation.graph(), appliedTurnKeys: [] }).toEqual({ ...graph, appliedTurnKeys: [] });
    expect(conversation.getState().previewCandidates).toEqual(preview);
    const decision = aside.calls.find(call => call.kind === 'renderer')!.payload!.applicationDecision as Json;
    expect(decision).toMatchObject({ actionKind: 'status', previewCount: 0, communication: { goal: 'report_status', statusReason: 'preview_unchanged' } });
    conversation = reload(conversation);
    assertCurrentPreview(conversation);
    expect(conversation.getState().previewCandidates).toEqual(preview);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: old, userId: conversation.ownerId })).toMatchObject({ kind: 'recompute_required' });
  });

  it.each(['semantic', 'provider'] as const)('a failed attempted correction retains accepted facts and explicitly recovers (%s)', async failure => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const graph = structuredClone(conversation.graph());
    const preview = structuredClone(conversation.getState().previewCandidates);
    script = call => {
      if (call.kind === 'renderer') return 'invalid renderer JSON';
      return failure === 'provider' ? { failure: 'network' } : 'invalid semantic JSON';
    };
    const failed = await conversation.submit(CORRECTION);
    expect(failed.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure });
    expect(failed.result?.failure?.code).toBe(failure === 'provider' ? 'stable_v5_provider_failure' : 'stable_v5_normalization_rejected');
    expect(conversation.graph()).toEqual(graph);
    expect(conversation.getState().previewCandidates).toEqual(preview);
    expect(conversation.getState().lastAssistantMessage).toBe(failed.result?.failure?.userMessage);
    expect(failed.result?.draftCandidates).toEqual([]);
    const render = failed.calls.find(call => call.kind === 'renderer');
    if (failure === 'semantic') expect(render!.payload!.applicationDecision).toMatchObject({
      actionKind: 'status', previewCount: 0, communication: { goal: 'clarify_turn' },
    });
    else expect(render).toBeUndefined();
    const restored = reload(conversation);
    expect(restored.graph()).toEqual(graph);
    expect(restored.getState().previewCandidates).toEqual(preview);
    // A failed interpretation never applies the proposed 20-page replacement.
    // Recovery must be explicit; the accepted 30-page draft is not silently relabelled.
    script = call => call.kind === 'semantic_generic' ? JSON.stringify(correction(call)) : undefined;
    await restored.submit(CORRECTION);
    assertCurrentPreview(restored);
    expect(restored.graph()!.revision).toBeGreaterThan(graph!.revision);
  });

  it('does not let recovery wording claim the unaccepted correction is the current preview', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const graph = structuredClone(conversation.graph());
    script = call => call.kind === 'renderer'
      ? scriptedRendererReply(call, '20ページの候補はそのままです。')
      : 'invalid semantic JSON';
    const failed = await conversation.submit(CORRECTION);
    expect(failed.result?.interactionOutcome?.kind).toBe('recover');
    expect(conversation.graph()).toEqual(graph);
    expect(failed.result?.responseSource).toBe('deterministic_fallback');
  });

  it('admits a simultaneous correction only once and reload does not replay it', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const revision = conversation.graph()!.revision;
    const graph = structuredClone(conversation.graph());
    const providerEntered = createDeferred<ScriptedProviderCall>();
    const gate = createDeferred<ScriptedProviderReply>();
    script = call => {
      if (call.kind !== 'semantic_generic') return undefined;
      providerEntered.resolve(call);
      return gate.promise;
    };
    const running = conversation.submit(CORRECTION);
    const call = await providerEntered.promise;
    const duplicate = await conversation.submit(CORRECTION);
    expect(duplicate.submission.accepted).toBe(false);
    expect(conversation.graph()).toEqual(graph);
    gate.resolve(JSON.stringify(correction(call)));
    const changed = await running;
    expect(changed.submission.accepted).toBe(true);
    expect(conversation.graph()!.revision).toBeGreaterThan(revision);
    expect(conversation.graph()!.correctionIntents).toHaveLength(1);
    const calls = provider.calls.length;
    const restored = reload(conversation);
    assertCurrentPreview(restored);
    expect(restored.graph()).toEqual(conversation.graph());
    expect(provider.calls).toHaveLength(calls);
  });

  it('keeps corrected chat A separate from chat B and rejects A old preview after A → B → A', async () => {
    const chatA = createScriptedConversation({ provider, architecture: 'interaction_v1', conversationId: 'preview-chat-a' });
    await chatA.submit(SETUP);
    const oldA = blocks(chatA);
    const chatB = createScriptedConversation({ provider, architecture: 'interaction_v1', conversationId: 'preview-chat-b' });
    await chatB.submit(SETUP);
    const graphB = structuredClone(chatB.graph());
    const previewB = structuredClone(chatB.getState().previewCandidates);
    script = call => call.kind === 'semantic_generic' ? JSON.stringify(correction(call)) : undefined;
    await chatA.submit(CORRECTION);
    expect(chatB.graph()).toEqual(graphB);
    expect(chatB.getState().previewCandidates).toEqual(previewB);
    assertCurrentPreview(chatA);
    assertCurrentPreview(chatB);
    const restoredA = reload(chatA);
    assertCurrentPreview(restoredA);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldA, userId: chatA.ownerId })).toMatchObject({ kind: 'recompute_required' });
    const restoredB = createScriptedConversation({ provider, conversationId: chatB.conversationId, initialState: chatB.getState() });
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: chatB.ownerId, weekStartDate: chatB.weekStartDate, conversationId: chatB.conversationId, graph: graphB! });
    assertCurrentPreview(restoredB);
    expect(restoredB.graph()).toEqual(graphB);
    assertCurrentPreview(restoredA);
  });

  it.each([false, true])('retains correction/fallback evidence through failed append, reload and Worker preparation (oversized=%s)', async oversized => {
    const conversationId = 'weekly-conversation-823e4567-e89b-42d3-a456-426614174001';
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', conversationId });
    await conversation.submit(SETUP);
    script = call => call.kind === 'semantic_generic' ? JSON.stringify(correction(call))
      : call.kind === 'renderer' ? 'malformed renderer JSON' : undefined;
    const changed = await conversation.submit(CORRECTION);
    expect(changed.result?.responseSource).toBe('deterministic_fallback');
    assertCurrentPreview(conversation);
    const state = structuredClone(conversation.getState());
    const graph = structuredClone(conversation.graph());
    const renderer = changed.calls.find(call => call.kind === 'renderer')!;
    const rendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(changed.result!.dialogueRendererTrace!);
    const prompt = rendererTrace.request!.promptContext as Json;
    expect(prompt.messages).toEqual(renderer.messages);
    const messages = prompt.messages as Array<{ role: string; content: string }>;
    const user = messages.find(message => message.role === 'user')!;
    const payload = JSON.parse(user.content) as Json;
    (payload.applicationDecision as Json).futurePreviewAuthoritySentinel = 'future-preview-authority-sentinel';
    if (oversized) payload.futureLargePreviewAuthority = 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2);
    user.content = JSON.stringify(payload);
    prompt.requestBytes = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
    const storage = createMemoryStorageHarness();
    const restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    const attempts: typeof writes = [];
    let failNext = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(params) {
        attempts.push(structuredClone(params));
        if (failNext) { failNext = false; throw new Error('injected preview authority append failure'); }
        writes.push(structuredClone(params));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    try {
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      setWeeklyPlanningTraceRepositoryForTests(repository);
      const input = { userId: conversation.ownerId, conversationId, requestId: changed.requestId!, userText: CORRECTION,
        assistantMessage: changed.result!.message, responseSource: changed.result!.responseSource,
        dialogueRendererTrace: rendererTrace, outcome: 'draft_created', debugTraceEvents: changed.debugTrace,
        previewCount: state.previewCandidates!.length };
      await recordWeeklyPlanningStableV5TurnTrace(input);
      expect(writes).toEqual([]);
      const queued = listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId });
      expect(queued).toHaveLength(1);
      expect(queued[0].input.dialogueRendererTrace).toEqual(rendererTrace);
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${changed.requestId}-retry`, debugTraceEvents: [] });
      expect(writes).toHaveLength(2);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId })).toEqual([]);
      const { observedAt: _firstTime, ...firstDiagnostic } = attempts[0].entries[0];
      const { observedAt: _retryTime, ...retryDiagnostic } = writes[0].entries[0];
      expect(retryDiagnostic).toEqual(firstDiagnostic);
      const prepared = prepareWeeklyPlanningTraceServerWrite({ session: writes[0].session as unknown as Json,
        entries: writes[0].entries as unknown as Json[] }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' },
      { sessionId: 'weekly-trace-823e4567-e89b-42d3-a456-426614174001', logicalConversationId: conversationId }, '2026-10-07T10:00:00.000Z');
      expect(prepared.entries).toHaveLength(1);
      expect(measureWeeklyPlanningTraceJsonBytes(writes[0].entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      const diagnostic = JSON.stringify(prepared.entries[0]);
      if (oversized) expect(diagnostic).toMatch(/truncat/i);
      else {
        expect(diagnostic).toContain('future-preview-authority-sentinel');
        expect(diagnostic).toContain('present_preview');
        expect(diagnostic).toContain('deterministic_fallback');
        expect(diagnostic).toContain('superseded');
      }
      expect(conversation.graph()).toEqual(graph);
      expect(conversation.getState()).toEqual(state);
      const restored = reload(conversation);
      expect(restored.graph()).toEqual(graph);
      expect(restored.getState().previewCandidates).toEqual(state.previewCandidates);
      assertCurrentPreview(restored);
    } finally {
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      restoreStorage();
    }
  });
});
