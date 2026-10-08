import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { FIXED_EVENT_TURNS, installFixedEventConversation } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository } from './weeklyPlanningTraceTypes';

vi.setConfig({ testTimeout: 30_000 });

type Json = Record<string, unknown>;
const USER = 'renderer-reliability-owner';
const CONVERSATION = 'weekly-conversation-9c753879-159c-4eea-832f-8d59e90e8991';
const SENTINEL = 'future-renderer-action-binding-evidence';
let restoreStorage: () => void;
let fixture: ReturnType<typeof installFixedEventConversation>;

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();

});
afterEach(() => {
  fixture?.provider.restore();
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage();
});

describe('fixed-event handoff trace durability', () => {
  it.each([false, true])('retains actual event-only status and prompt through retry/Worker/limits (invalid renderer: %s)', async invalid => {
    fixture = installFixedEventConversation({ ownerId: USER, conversationId: CONVERSATION,
      ...(invalid ? { rendererText: '登録しました。' } : {}) });
    await fixture.conversation.submit(FIXED_EVENT_TURNS[0]);
    await fixture.conversation.submit(FIXED_EVENT_TURNS[1]);
    const turn = await fixture.conversation.submit(FIXED_EVENT_TURNS[2]);
    expect(turn.result?.state.lastQuestionContext).toBeUndefined();
    expect(turn.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
    expect(turn.result?.message).toContain('予定を追加');
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
    expect(turn.result?.failure).toBeUndefined();
    const calls = turn.calls.filter(call => call.kind === 'renderer');
    expect(calls).toHaveLength(1);
    expect(calls[0].payload!.actionId).toBe('a1');
    const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
    expect(trace.actionId).not.toBe('a1');
    expect(trace.actionId).toContain(CONVERSATION);
    expect(trace.response.status).toBe(invalid ? 'fallback' : 'rendered');
    expect(trace.response.reason).toBe(invalid ? 'action_contract_mismatch' : null);
    expect(JSON.parse(trace.response.rawResponse!).actionId).toBe('a1');
    const context = trace.request!.promptContext as Json;
    expect(context.messages).toEqual(calls[0].messages);
    expect(context.responseFormat).toEqual(calls[0].request.response_format);
    expect(context.actionBinding).toEqual({ token: 'a1', actionId: trace.actionId });
    expect(JSON.stringify(context)).toContain('fixed_event_manual_entry');
    expect(JSON.stringify(context)).toContain('register_event');
    expect(fixture.conversation.graph()!.tasks).toHaveLength(1);
    expect(fixture.conversation.graph()!.workloads).toEqual([]);
    const binding = context.actionBinding as Json;
    binding.futureField = SENTINEL;
    const input = {
      userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: FIXED_EVENT_TURNS[2],
      assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
      dialogueRendererTrace: trace, outcome: 'needs_scope', previewCount: 0, debugTraceEvents: turn.debugTrace,
    };
    const oversized = structuredClone(input);
    oversized.requestId = `${CONVERSATION}:oversized`;
    ((oversized.dialogueRendererTrace.request!.promptContext as Json).actionBinding as Json).futureLargeField = '大'.repeat(30_000);
    oversized.dialogueRendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(oversized.dialogueRendererTrace);
    const entries: WeeklyPlanningTraceEntry[] = [];
    let failOnce = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(write) {
        if (failOnce) { failOnce = false; throw new Error('injected renderer append failure'); }
        const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json,
          entries: write.entries as unknown as Json[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '107' }, {
          sessionId: 'weekly-trace-9c753879-159c-4eea-832f-8d59e90e8991', logicalConversationId: CONVERSATION,
        }, '2026-10-08T00:00:00.000Z');
        for (const entry of write.entries) {
          expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
          const worker = prepared.entries.find(candidate => candidate.requestId === entry.requestId)!;
          expect(measureWeeklyPlanningTraceJsonBytes(worker)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
          for (const persisted of [entry, worker]) {
            const serialized = JSON.stringify(persisted);
            if (entry.requestId === input.requestId) {
              expect(serialized).toContain(SENTINEL);
              expect(serialized).toContain(trace.actionId!);
              expect(serialized).toContain('actionBinding');
              expect(serialized).toContain(invalid ? 'action_contract_mismatch' : 'ai_rendered');
              expect(persisted.kind).toBe('turn_diagnostic');
              const renderer = ((persisted as unknown as Json).diagnostics as Json).dialogueRenderer as typeof trace;
              expect(renderer.request!.promptContext).toEqual(context);
              expect(renderer.response.rawResponse).toBe(trace.response.rawResponse);
            } else {
              expect(serialized).toMatch(/truncated|Truncated/u);
              expect(serialized).not.toContain('大'.repeat(30_000));
            }
          }
        }
        entries.push(...write.entries);
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(entries).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(oversized);
    expect(entries).toHaveLength(2);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);
  });
});
