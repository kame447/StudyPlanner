import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import { classifyWeeklyPlanningApprovalAvailability } from './application/weeklyPlanningApprovalAvailability';
import { createWeeklyDraftBlocksFromPreviewCandidates } from './preview/weeklyPlanningPreviewBlocks';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { setWeeklyPlanningTraceRepositoryForTests } from './trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './trace/weeklyPlanningTraceOutbox';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './trace/weeklyPlanningStableV5TraceRuntime';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './trace/weeklyPlanningTraceTypes';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

type Json = Record<string, unknown>;
const SETUP = '来週、アルゴリズムイントロダクションを30ページ読みたい。1ページ4分くらい';
const CORRECTION = 'やっぱり20ページにして、金曜日までに終わらせたい';
const DATE_ANSWER = '10月16日まで';
const DEADLINE_ONLY = '金曜日までに終わらせたい';
const TITLE = 'アルゴリズムイントロダクション';

function emptyDocument(overrides: Json = {}): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [],
    ...overrides,
  };
}

function workload(amount: number, sourceText: string): Json {
  return {
    localId: 'pages', quantityRole: 'target', amount, unitCode: 'page', unitLabel: 'ページ',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText,
  };
}

function effort(): Json {
  return {
    localId: 'rate', targetLocalId: 'pages', kind: 'duration_per_unit', minutes: 4,
    unitCode: 'page', precision: 'approximate', sourceText: '1ページ4分くらい',
  };
}

function task(overrides: Json = {}): Json {
  return {
    localId: 'book', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: TITLE,
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
    sourceText: 'アルゴリズムイントロダクションを30ページ読みたい', ...overrides,
  };
}

function setupDocument(): Json {
  return emptyDocument({
    planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [task({ workloads: [workload(30, '30ページ読みたい')], effortEstimates: [effort()] })],
  });
}

function facts(call: ScriptedProviderCall, key: string): Json[] {
  return ((call.payload?.publicStateSummary as Json)?.[key] ?? []) as Json[];
}

function correctionDocument(call: ScriptedProviderCall, copiedEffort = false): Json {
  const boundTask = facts(call, 'tasks')[0];
  const boundWorkload = facts(call, 'workloads')[0];
  return emptyDocument({
    planningIntent: 'update_plan',
    tasks: [task({
      existingPublicId: boundTask.publicId, sourceText: CORRECTION,
      workloads: [workload(20, '20ページにして')], effortEstimates: copiedEffort ? [effort()] : [],
      temporalConstraints: [{
        localId: 'deadline', targetLocalId: 'book', kind: 'deadline', constraintLevel: 'hard',
        dateExpression: '2026-10-16', namedTimePeriod: null, startTime: null, endTime: null,
        precision: 'exact', sourceText: '金曜日までに終わらせたい',
      }],
    })],
    corrections: [{
      localId: 'fix-pages', target: { kind: 'workload', publicId: boundWorkload.publicId, localId: null, mention: '30ページ' },
      operation: 'replace', replacementLocalId: 'pages', sourceText: 'やっぱり20ページにして',
    }],
  });
}

function dateAnswerDocument(call: ScriptedProviderCall): Json {
  const boundTask = facts(call, 'tasks')[0];
  const boundDeadline = facts(call, 'temporalConstraints')[0];
  return emptyDocument({
    planningIntent: 'update_plan',
    tasks: [task({
      existingPublicId: boundTask.publicId, sourceText: DATE_ANSWER,
      temporalConstraints: [{
        localId: 'deadline-answer', targetLocalId: 'book', kind: 'deadline', constraintLevel: 'hard',
        dateExpression: '2026-10-16', namedTimePeriod: null, startTime: null, endTime: null,
        precision: 'exact', sourceText: DATE_ANSWER,
      }],
    })],
    corrections: [{
      localId: 'fix-deadline', target: { kind: 'temporal_constraint', publicId: boundDeadline.publicId, localId: null, mention: null },
      operation: 'replace', replacementLocalId: 'deadline-answer', sourceText: DATE_ANSWER,
    }],
  });
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let copiedEffort: boolean;
let mutateCorrection: ((document: Json) => void) | undefined;
let rendererText: string;
beforeEach(() => {
  resetScriptedConversationRuntime();
  copiedEffort = false;
  mutateCorrection = undefined;
  rendererText = '候補を確認してください。';
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') {
      // Renderer repair appends prose after the original JSON payload; keep the
      // action identity so the repair also tests text validation, not shape errors.
      const renderCall = call.payload ? call : {
        ...call, payload: JSON.parse(call.messages.find(message => message.role === 'user')!.content) as Json,
      };
      return scriptedRendererReply(renderCall, rendererText);
    }
    const userText = call.payload?.userText;
    const serialize = (document: Json) => {
      if (!call.schemaProperties.includes('conversationActs')) delete document.conversationActs;
      return JSON.stringify(document);
    };
    if (userText === SETUP) return serialize(setupDocument());
    if (userText === DATE_ANSWER) return serialize(dateAnswerDocument(call));
    if (userText === CORRECTION || userText === DEADLINE_ONLY || call.payload?.validationErrors) {
      const original = call.payload?.validationErrors
        ? [...provider.calls].reverse().find(entry => entry.kind === 'semantic_generic' && entry.payload?.userText === CORRECTION)!
        : call;
      const document = correctionDocument(original, copiedEffort);
      if (userText === DEADLINE_ONLY) {
        const boundTask = (document.tasks as Json[])[0];
        boundTask.sourceText = DEADLINE_ONLY;
        boundTask.workloads = [];
        boundTask.effortEstimates = [];
        document.corrections = [];
      }
      mutateCorrection?.(document);
      return serialize(document);
    }
    return JSON.stringify(emptyDocument());
  });
});
afterEach(() => {
  provider.restore();
  resetScriptedConversationRuntime();
});

describe('real E2E Scenario C correction through production controller', () => {
  it('invalidates an existing work preview when an added hard deadline still needs a date', async () => {
    mutateCorrection = document => {
      ((document.tasks as Json[])[0].temporalConstraints as Json[])[0].dateExpression = 'custom:Friday of the intended week';
    };
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const oldPreview = structuredClone(conversation.getState().previewCandidates)!;
    const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: oldPreview, userId: conversation.ownerId, createdAt: '2026-10-07T09:00:00.000Z',
    });
    const changed = await conversation.submit(DEADLINE_ONLY);
    expect(changed.result?.failure).toBeUndefined();
    expect(conversation.graph()!.temporalConstraints).toHaveLength(1);
    expect(changed.result?.state.questions.length).toBeGreaterThan(0);
    expect(changed.result?.preserveExistingPreview).not.toBe(true);
    expect(conversation.getState().previewCandidates).toEqual([]);
    expect(changed.result?.communicationFacts?.statusReason).not.toBe('preview_unchanged');
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId: conversation.ownerId }))
      .toMatchObject({ kind: 'recompute_required' });
    const answered = await conversation.submit(DATE_ANSWER);
    expect(answered.result?.failure).toBeUndefined();
    expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
    expect(conversation.getState().previewCandidates?.every(candidate => candidate.date <= '2026-10-16')).toBe(true);
  });

  it.each(['accepted-correction', 'rejected-correction'] as const)('rejects misleading unchanged-preview prose after %s', async (scenario) => {
    copiedEffort = true;
    mutateCorrection = document => {
      if (scenario === 'rejected-correction') {
        ((document.tasks as Json[])[0].effortEstimates as Json[])[0].minutes = 5;
      } else {
        ((document.tasks as Json[])[0].temporalConstraints as Json[])[0].dateExpression = 'custom:Friday of the intended week';
      }
    };
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const beforeGraph = structuredClone(conversation.graph())!;
    const beforePreview = structuredClone(conversation.getState().previewCandidates);
    rendererText = '今の仮予定の候補はそのままです。何日までに終わらせたいですか？';
    const corrected = await conversation.submit(CORRECTION);
    expect(corrected.result?.dialogueRendererTrace?.response.reason).toBe('preview_claim_without_preview');
    expect(corrected.result?.responseSource).toBe('deterministic_fallback');
    expect(corrected.result?.message).not.toContain('候補はそのまま');
    expect(corrected.result?.communicationFacts?.statusReason).not.toBe('preview_unchanged');
    expect(conversation.getState().previewCandidates).toEqual(scenario === 'accepted-correction' ? [] : beforePreview);
    if (scenario === 'rejected-correction') expect(conversation.graph()).toEqual(beforeGraph);
    else expect(conversation.graph()!.revision).toBeGreaterThan(beforeGraph.revision);
  });

  it('keeps legacy additive-deadline preview retention unchanged', async () => {
    mutateCorrection = document => {
      ((document.tasks as Json[])[0].temporalConstraints as Json[])[0].dateExpression = 'custom:Friday of the intended week';
    };
    const conversation = createScriptedConversation({ provider, architecture: 'legacy_v5' });
    await conversation.submit(SETUP);
    const oldPreview = structuredClone(conversation.getState().previewCandidates);
    const changed = await conversation.submit(DEADLINE_ONLY);
    expect(changed.result?.failure).toBeUndefined();
    expect(changed.result?.preserveExistingPreview).toBe(true);
    expect(conversation.getState().previewCandidates).toEqual(oldPreview);
  });

  it('applies a grounded replacement and deadline without asking for the known book again', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
    const before = conversation.getState().previewCandidates;
    const corrected = await conversation.submit(CORRECTION);
    expect(corrected.result?.interactionOutcome?.kind).toBe('apply');
    const graph = conversation.graph()!;
    const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(graph.workloads.filter(entry => active.has(entry.id)).map(entry => entry.amount)).toEqual([20]);
    expect(conversation.getState().previewCandidates).not.toEqual(before);
    expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
  });

  it('projects the accepted rate echo out of the delta and rebuilds the corrected preview, including a date answer', async () => {
    copiedEffort = true;
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const before = structuredClone(conversation.graph())!;
    const preview = structuredClone(conversation.getState().previewCandidates);
    const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: preview!, userId: conversation.ownerId, createdAt: '2026-10-07T09:00:00.000Z',
    });
    const corrected = await conversation.submit(CORRECTION);
    expect(corrected.result?.interactionOutcome?.kind).toBe('apply');
    expect(corrected.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(JSON.stringify(corrected.debugTrace)).toContain('committed-correction-rate-context-omitted');
    const graph = conversation.graph()!;
    const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    const replacement = graph.workloads.find(entry => active.has(entry.id))!;
    expect(replacement.amount).toBe(20);
    const rate = graph.effortEstimates.filter(entry => active.has(entry.id));
    expect(rate).toHaveLength(1);
    const originalSource = before.effortEstimates[0].source;
    expect(rate[0]).toMatchObject({ targetFactId: replacement.id, minutes: 4, source: {
      conversationId: originalSource.conversationId, turnId: originalSource.turnId,
      sourceText: originalSource.sourceText, origin: originalSource.origin,
      semanticLocalId: expect.stringContaining(`${originalSource.semanticLocalId}:carry:`),
    } });
    expect(conversation.getState().previewCandidates).not.toEqual(preview);
    expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
    expect(conversation.getState().intakeState?.questions).toEqual([]);
    expect(conversation.getState().previewCandidates?.every(candidate => candidate.date <= '2026-10-16')).toBe(true);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId: conversation.ownerId })).toMatchObject({ kind: 'recompute_required' });
    const updatedPreview = structuredClone(conversation.getState().previewCandidates);
    const answered = await conversation.submit(DATE_ANSWER);
    expect(answered.result?.interactionOutcome?.kind).toBe('apply');
    expect(conversation.getState().previewCandidates).not.toEqual(updatedPreview);
    expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
    const finalGraph = conversation.graph()!;
    const finalActive = new Set(finalGraph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(finalGraph.workloads.filter(entry => finalActive.has(entry.id)).map(entry => entry.amount)).toEqual([20]);
    expect(finalGraph.temporalConstraints.filter(entry => finalActive.has(entry.id))).toMatchObject([{ dateExpression: '2026-10-16' }]);
  });

  it('preserves the legacy rejection and unchanged preview byte for byte', async () => {
    copiedEffort = true;
    const conversation = createScriptedConversation({ provider, architecture: 'legacy_v5' });
    await conversation.submit(SETUP);
    const graph = JSON.stringify(conversation.graph());
    const preview = JSON.stringify(conversation.getState().previewCandidates);
    const rejected = await conversation.submit(CORRECTION);
    expect(JSON.stringify(rejected.debugTrace)).toContain('effortEstimates[0].sourceText:not-grounded-in-current-user-text');
    expect(JSON.stringify(conversation.graph())).toBe(graph);
    expect(JSON.stringify(conversation.getState().previewCandidates)).toBe(preview);
  });

  it.each(['interaction_v1', 'legacy_v5'] as const)('clears the replaced preview during deadline clarification and binds the date answer (%s)', async (architecture) => {
    copiedEffort = architecture === 'interaction_v1';
    mutateCorrection = document => {
      ((document.tasks as Json[])[0].temporalConstraints as Json[])[0].dateExpression = 'custom:Friday of the intended week';
    };
    const conversation = createScriptedConversation({ provider, architecture });
    await conversation.submit(SETUP);
    const corrected = await conversation.submit(CORRECTION);
    expect(corrected.result?.failure).toBeUndefined();
    expect({ graph: conversation.graph(), result: corrected.result }).toMatchObject({
      graph: { workloads: expect.arrayContaining([expect.objectContaining({ amount: 20 })]) },
      result: { draftCandidates: [] },
    });
    expect(conversation.getState().previewCandidates).toEqual([]);
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).not.toBe('stable_v5:missing_schedulable_work');
    const answered = await conversation.submit(DATE_ANSWER);
    expect(answered.result?.failure).toBeUndefined();
    expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
    const graph = conversation.graph()!;
    const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(graph.tasks.filter(entry => active.has(entry.id)).map(entry => entry.title)).toEqual([TITLE]);
    expect(graph.workloads.filter(entry => active.has(entry.id)).map(entry => entry.amount)).toEqual([20]);
  });

  it.each(['changed-rate', 'unknown-target', 'unbound-task', 'changed-unit', 'new-rate-citation', 'referenced-rate', 'ungrounded-replacement'] as const)('rejects %s atomically', async (invalid) => {
    copiedEffort = true;
    mutateCorrection = document => {
      const entry = (document.tasks as Json[])[0];
      if (invalid === 'changed-rate') (entry.effortEstimates as Json[])[0].minutes = 5;
      if (invalid === 'unknown-target') ((document.corrections as Json[])[0].target as Json).publicId = 'foreign-workload';
      if (invalid === 'unbound-task') entry.existingPublicId = null;
      if (invalid === 'changed-unit') (entry.workloads as Json[])[0].unitCode = 'problem';
      if (invalid === 'new-rate-citation') (entry.effortEstimates as Json[])[0].sourceText = '1ページ4分';
      if (invalid === 'referenced-rate') document.uncertainties = [{
        localId: 'rate-question', targetLocalId: 'rate', field: 'effort', reason: 'rate unclear', sourceText: CORRECTION,
      }];
      if (invalid === 'ungrounded-replacement') (entry.workloads as Json[])[0].sourceText = '以前20ページと言いました';
    };
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const graph = structuredClone(conversation.graph());
    const preview = structuredClone(conversation.getState().previewCandidates);
    const rejected = await conversation.submit(CORRECTION);
    expect(rejected.result?.interactionOutcome?.kind).toBe('recover');
    expect(conversation.graph()).toEqual(graph);
    expect(conversation.getState().previewCandidates).toEqual(preview);
  });

  it.each(['corrected-preview', 'deadline-clarification', 'correction-clarification'] as const)('persists %s requests, state and renderer decisions through outbox retry and Worker limits', async (scenario) => {
    copiedEffort = true;
    const conversationId = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174001';
    const canonicalIds = { sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174001', logicalConversationId: conversationId };
    const conversation = createScriptedConversation({ provider, conversationId, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const userText = scenario === 'deadline-clarification' ? DEADLINE_ONLY : CORRECTION;
    if (scenario !== 'corrected-preview') {
      mutateCorrection = document => {
        ((document.tasks as Json[])[0].temporalConstraints as Json[])[0].dateExpression = 'custom:Friday of the intended week';
      };
      rendererText = '今の仮予定の候補はそのままです。何日までに終わらせたいですか？';
    }
    const corrected = await conversation.submit(userText);
    expect(corrected.result?.interactionOutcome?.kind).toBe('apply');
    const sent = corrected.calls.find(call => call.kind === 'semantic_generic')!;
    const requestEvent = corrected.debugTrace.find(event => event.stage === 'semantic_provider_request')!;
    expect(((requestEvent.data as Json).request as Json).messages).toEqual(sent.messages);
    const validation = corrected.debugTrace.find(event => event.stage === 'semantic_validation_result')!;
    expect((validation.data as Json).parsedDocument).toMatchObject({ tasks: [{ effortEstimates: [] }] });
    if (scenario !== 'corrected-preview') {
      expect(conversation.getState().previewCandidates).toEqual([]);
      expect(corrected.result?.dialogueRendererTrace?.response.reason).toBe('preview_claim_without_preview');
    }

    const storage = createMemoryStorageHarness();
    const restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    const attempts: typeof writes = [];
    let failWrites = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(params) {
        attempts.push(structuredClone(params));
        if (failWrites) throw new Error('injected correction trace failure');
        writes.push(structuredClone(params));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    try {
      for (const oversized of [false, true]) {
        storage.storage.clear();
        resetWeeklyPlanningStableV5TraceRuntimeForTest();
        setWeeklyPlanningTraceRepositoryForTests(repository);
        writes.length = 0;
        attempts.length = 0;
        failWrites = true;
        const events = structuredClone(corrected.debugTrace);
        const projected = (events.find(event => event.stage === 'semantic_validation_result')!.data as Json).parsedDocument as Json;
        ((projected.tasks as Json[])[0]).futureCorrectionSentinel = 'correction-context-future-field';
        if (oversized) projected.futureLargeField = 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2);
        const input = {
          userId: conversation.ownerId, conversationId, requestId: corrected.requestId!, userText,
          assistantMessage: corrected.result!.message, responseSource: corrected.result!.responseSource,
          dialogueRendererTrace: corrected.result!.dialogueRendererTrace,
          outcome: scenario === 'corrected-preview' ? 'draft_created' : 'question', debugTraceEvents: events,
          previewCount: conversation.getState().previewCandidates?.length ?? 0,
        };
        await recordWeeklyPlanningStableV5TurnTrace(input);
        expect(writes).toHaveLength(0);
        const queued = listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId });
        expect(queued).toHaveLength(1);
        expect(queued[0].input.debugTraceEvents).toEqual(input.debugTraceEvents);
        const queuedContent = attempts[0].entries[0];
        resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
        failWrites = false;
        await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${input.requestId}-retry`, debugTraceEvents: [] });
        expect(writes).toHaveLength(2);
        expect(listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId })).toEqual([]);
        const stored = writes[0].entries[0];
        const { observedAt: _queuedAt, ...queuedDiagnostic } = queuedContent;
        const { observedAt: _writtenAt, ...storedDiagnostic } = stored;
        expect(storedDiagnostic).toEqual(queuedDiagnostic);
        expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        const prepared = prepareWeeklyPlanningTraceServerWrite({
          session: writes[0].session as unknown as Json, entries: writes[0].entries as unknown as Json[],
        }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, canonicalIds, '2026-10-07T00:00:00.000Z');
        expect(prepared.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        const serialized = JSON.stringify(prepared.entries[0]);
        expect((prepared.entries[0] as unknown as Json).diagnostics).toMatchObject({
          previewCount: scenario === 'corrected-preview' ? expect.any(Number) : 0,
        });
        if (oversized) expect(serialized).toContain('truncation');
        else {
          expect(serialized).toContain('correction-context-future-field');
          expect(serialized).toContain(userText);
          expect(serialized).toContain('1ページ4分くらい');
          if (scenario !== 'deadline-clarification') expect(serialized).toContain('superseded');
          if (scenario !== 'corrected-preview') {
            expect(serialized).toContain('preview_claim_without_preview');
            expect(serialized).toContain('custom:Friday of the intended week');
          }
          const diagnostic = stored as unknown as Json;
          const request = (((diagnostic.aiInterpreter as Json).input as Json).requests as Json[])[0];
          const messages = request.messages as Array<{ role: string; content: string }>;
          expect(messages.map(message => message.role)).toEqual(sent.messages.map(message => message.role));
          messages.forEach((message, index) => expect(message.content.startsWith(sent.messages[index].content.slice(0, 128))).toBe(true));
          expect(messages[1].content).toContain(userText);
        }
      }
    } finally {
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      restoreStorage();
    }
  });
});
