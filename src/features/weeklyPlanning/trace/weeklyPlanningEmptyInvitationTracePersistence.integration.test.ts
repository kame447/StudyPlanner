import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository } from './weeklyPlanningTraceTypes';

type Json = Record<string, unknown>;
const USER = 'empty-invitation-trace-owner';
const CONVERSATION = 'weekly-conversation-9c753879-159c-4eea-832f-8d59e90e8991';
const SENTINEL = 'future-empty-invitation-evidence';
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

it('persists the actual optional-invitation closure through retry, Worker preparation and all size/sentinel/truncation boundaries', async () => {
  let phase = 0;
  provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer' ? eventRendererReply(call)
    : JSON.stringify(phase === 0 ? eventDocument({ planningIntent: 'create_plan', planningWindow: { localId: 'today', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日' }, conversationActs: [] })
      : eventDocument({ conversationActs: [{ kind: 'decline_additional_work', targetPublicId: null }] })));
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', ownerId: USER, conversationId: CONVERSATION, now: () => '2026-10-07T00:00:00.000Z' });
  const first = await conversation.submit('今日の予定を立てたい');
  expect(first.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
  const before = conversation.graph()!;
  phase = 1;
  const turn = await conversation.submit('ない');
  expect(turn.result?.failure).toBeUndefined();
  expect(turn.result?.communicationFacts?.statusReason).toBe('no_additional_work');
  expect(turn.result?.state.lastQuestionContext).toBeUndefined();
  expect(turn.result?.state.shouldSavePlan).not.toBe(true);
  expect(conversation.graph()!.factLifecycles).toEqual(before.factLifecycles);
  const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
  const renderer = turn.calls.find(call => call.kind === 'renderer')!;
  const context = trace.request!.promptContext as Json;
  expect(context.messages).toEqual(renderer.messages);
  expect(context.responseFormat).toEqual(renderer.request.response_format);
  expect(JSON.stringify(context)).toContain('no_additional_work');
  (context.actionBinding as Json).futureField = SENTINEL;
  const input = { userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: 'ない',
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, dialogueRendererTrace: trace,
    outcome: turn.result!.state.status, previewCount: 0, debugTraceEvents: turn.debugTrace };
  const oversized = structuredClone(input);
  oversized.requestId = `${input.requestId}-large`;
  ((oversized.dialogueRendererTrace.request!.promptContext as Json).actionBinding as Json).futureLargeField = 'x'.repeat(60_000);
  oversized.dialogueRendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(oversized.dialogueRendererTrace);
  const entries: WeeklyPlanningTraceEntry[] = [];
  const serverEntries: Json[] = [];
  let failOnce = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(write) {
      if (failOnce) { failOnce = false; throw new Error('injected empty-invitation append failure'); }
      const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json, entries: write.entries as unknown as Json[] },
        { token: `wpt_${'a'.repeat(43)}`, epoch: '107' }, { sessionId: 'weekly-trace-9c753879-159c-4eea-832f-8d59e90e8991', logicalConversationId: CONVERSATION }, '2026-10-08T00:00:00.000Z');
      entries.push(...write.entries); serverEntries.push(...prepared.entries);
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(input);
  expect(entries).toEqual([]);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace(oversized);
  expect(entries).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);
  for (const entry of entries) {
    const server = serverEntries.find(candidate => candidate.requestId === entry.requestId)!;
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    expect(measureWeeklyPlanningTraceJsonBytes(server)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const persisted of [entry, server]) {
      const serialized = JSON.stringify(persisted);
      if (entry.requestId === input.requestId) {
        expect(serialized).toContain(SENTINEL);
        expect(serialized).toContain('no_additional_work');
      } else {
        expect(serialized).toMatch(/truncated|Truncated|truncation/u);
        expect(serialized).not.toContain('x'.repeat(60_000));
      }
    }
  }
});
