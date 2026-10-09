import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { eventRendererReply } from './testUtils/weeklyPlanningFixedEventOnlyFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './trace/weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './trace/weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './trace/weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository } from './trace/weeklyPlanningTraceTypes';

// x9b: the focused replacement-fact repair adds its own semantic request (a typed schema) and route trace to the turn. They are part
// of the persisted diagnostics: they must survive the outbox, Worker preparation and byte caps (the renderer trace carries a
// future-field sentinel, as in the sibling persistence tests).
type Json = Record<string, unknown>;
const USER = 'focused-replacement-trace-owner';
const CONVERSATION = 'weekly-conversation-3b1d8f52-6a0e-4b0a-9a53-0d3f6f6e8a11';
const SENTINEL = 'future-focused-replacement-evidence';
const CLAUSE = 'focused_replacement_fact_repair';
let restoreStorage: () => void;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
});
afterEach(() => {
  provider?.restore(); resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined); restoreStorage();
});

describe('focused replacement-fact repair at the trace persistence boundary', () => {
  it('persists the instruction through outbox, Worker preparation, caps and a sentinel', async () => {
    const T1 = '来週、レポートの文献を30ページ読む。1ページ3分くらい';
    const userText = 'やっぱり20ページにして、金曜日までに終わらせたい';
    const base = (o: Json): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
      availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...o });
    const task = (o: Json): Json => ({ localId: 'paper', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
      study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [],
      recurrence: [], durableContextSignals: [], sourceText: '文献を読む', ...o });
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return eventRendererReply(call);
      if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
      if (call.schemaName === 'weekly_planning_focused_replacement_fact_repair_v5') return JSON.stringify({ replacements: [{ localId: 'pages20', decision: 'provided',
        quantityRole: 'target', amount: 20, unitCode: 'page', unitLabel: 'ページ', sourceText: '20ページ' }] });
      const text = String(call.payload?.userText ?? '');
      const summary = (call.payload?.publicStateSummary ?? {}) as Json;
      if (text === T1) return JSON.stringify(base({ planningIntent: 'create_plan', planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
        tasks: [task({ workloads: [{ localId: 'amt', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '30ページ' }],
          effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分くらい' }] })] }));
      const taskId = String((((summary.tasks as Json[]) ?? [])[0] ?? {}).publicId);
      const workloadId = String((((summary.workloads as Json[]) ?? [])[0] ?? {}).publicId);
      return JSON.stringify(base({ corrections: [{ localId: 'c1', target: { kind: 'workload', publicId: workloadId, localId: null, mention: null }, operation: 'replace',
        replacementLocalId: 'pages20', sourceText: 'やっぱり20ページにして' }], tasks: [task({ existingPublicId: taskId, sourceText: userText })] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', ownerId: USER,
      conversationId: CONVERSATION, weekStartDate: '2030-01-07', now: () => '2030-01-01T00:00:00.000Z' });
    await conversation.submit(T1);
    const turn = await conversation.submit(userText);
    expect(turn.calls.some(call => call.schemaName === 'weekly_planning_focused_replacement_fact_repair_v5')).toBe(true);
    expect(turn.result?.interactionOutcome?.kind).toBe('apply');
    const persistedKeys = ['weekly_planning_focused_replacement_fact_repair_v5'];
    const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
    const context = trace.request!.promptContext as Json;
    context.futureRendererProjection = SENTINEL;
    const input = { userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText,
      assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
      dialogueRendererTrace: trace, outcome: 'success' as const, previewCount: 0, debugTraceEvents: turn.debugTrace };
    const entries: WeeklyPlanningTraceEntry[] = [];
    let failOnce = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(write) {
        if (failOnce) { failOnce = false; throw new Error('synthetic first trace append failure'); }
        const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json,
          entries: write.entries as unknown as Json[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '107' }, {
          sessionId: 'weekly-trace-3b1d8f52-6a0e-4b0a-9a53-0d3f6f6e8a11', logicalConversationId: CONVERSATION,
        }, '2030-01-01T00:00:00.000Z');
        for (const entry of write.entries.filter(candidate => candidate.requestId === input.requestId)) {
          expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
          const worker = prepared.entries.find(candidate => candidate.requestId === entry.requestId)!;
          expect(measureWeeklyPlanningTraceJsonBytes(worker)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
          for (const persisted of [entry, worker]) {
            expect(JSON.stringify(persisted)).toContain(SENTINEL);
            expect(JSON.stringify(persisted)).toContain(CLAUSE);
            for (const key of persistedKeys) expect(JSON.stringify(persisted)).toContain(key);
          }
        }
        entries.push(...write.entries);
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {},
      async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(entries).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    // a large unregistered value is truncated explicitly, never dropping the turn
    const oversized = structuredClone(input);
    oversized.requestId = `${CONVERSATION}:oversized`;
    (oversized.dialogueRendererTrace.request!.promptContext as Json).futureLargeProjection = '大'.repeat(50_000);
    oversized.dialogueRendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(oversized.dialogueRendererTrace);
    await recordWeeklyPlanningStableV5TurnTrace(oversized);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(0);
  });
});
