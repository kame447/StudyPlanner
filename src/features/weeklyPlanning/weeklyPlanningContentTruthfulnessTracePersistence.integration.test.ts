import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply, eventStudyTask } from './testUtils/weeklyPlanningFixedEventOnlyFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './trace/weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './trace/weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './trace/weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository } from './trace/weeklyPlanningTraceTypes';

// The recovery renderer instruction now says nothing about the request's feasibility (live D 「その分け方
// では進められません」). The instruction text is part of the persisted renderer request: it must survive
// the outbox, Worker preparation and byte caps with a future-field sentinel.
type Json = Record<string, unknown>;
const USER = 'truthfulness-trace-owner';
const CONVERSATION = 'weekly-conversation-3b1d8f52-6a0e-4b0a-9a53-0d3f6f6e8a11';
const SENTINEL = 'future-truthfulness-evidence';
const CLAUSE = 'whether it is possible';
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

describe('recovery wording instruction at the trace persistence boundary', () => {
  it('persists the instruction through outbox, Worker preparation, caps and a sentinel', async () => {
    let recovering = false;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return recovering ? '{invalid-renderer-json' : eventRendererReply(call);
      if (recovering) return '{invalid-semantic-json';
      return JSON.stringify(eventDocument({ planningIntent: 'create_plan', planningWindow: {
        localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週',
      }, tasks: [eventStudyTask()], conversationActs: [] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', ownerId: USER,
      conversationId: CONVERSATION, weekStartDate: '2030-01-07', now: () => '2030-01-01T00:00:00.000Z' });
    await conversation.submit('来週、数学を20分勉強する');
    recovering = true;
    const userText = '締切を変えたい';
    const turn = await conversation.submit(userText);
    const rendererCall = turn.calls.find(call => call.kind === 'renderer')!;
    const request = JSON.parse(rendererCall.messages.find(message => message.role === 'user')!.content);
    expect(request.request).toContain(CLAUSE);
    const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
    const context = trace.request!.promptContext as Json;
    expect(JSON.stringify(context.messages)).toContain(CLAUSE);
    context.futureRendererProjection = SENTINEL;
    const input = { userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText,
      assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
      dialogueRendererTrace: trace, outcome: 'failure' as const, previewCount: 0, debugTraceEvents: turn.debugTrace };
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
        for (const entry of write.entries) {
          expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
          const worker = prepared.entries.find(candidate => candidate.requestId === entry.requestId)!;
          expect(measureWeeklyPlanningTraceJsonBytes(worker)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
          for (const persisted of [entry, worker]) {
            expect(JSON.stringify(persisted)).toContain(SENTINEL);
            expect(JSON.stringify(persisted)).toContain(CLAUSE);
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
