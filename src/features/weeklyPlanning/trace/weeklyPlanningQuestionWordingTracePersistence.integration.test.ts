// Load the runtime before the measured test; synthetic provider transport only.
import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply, eventStudyTask, FIXED_EVENT_TURNS, installFixedEventConversation } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository } from './weeklyPlanningTraceTypes';


type Json = Record<string, unknown>;
const USER = 'question-wording-owner';
const CONVERSATION = 'weekly-conversation-9c753879-159c-4eea-832f-8d59e90e8991';
const SENTINEL = 'future-question-wording-context';
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

describe('intent-aware question wording trace durability', () => {
  it.each(['question', 'handoff', 'study'] as const)('retains the actual %s prompt through outbox retry, Worker and limits', async kind => {
    const userText = kind === 'study' ? '数学を勉強したい' : FIXED_EVENT_TURNS[0];
    if (kind === 'study') {
      const provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer'
        ? eventRendererReply(call, '数学は、今どこまで進んでいますか？')
        : JSON.stringify(eventDocument({ tasks: [{ ...eventStudyTask(), title: '数学', workloads: [], sourceText: userText }], conversationActs: [] })));
      fixture = { provider, conversation: createScriptedConversation({ provider, ownerId: USER,
        conversationId: CONVERSATION, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' }) };
    } else {
      fixture = installFixedEventConversation({ ownerId: USER, conversationId: CONVERSATION });
    }
    const first = await fixture.conversation.submit(userText);
    if (kind === 'handoff') await fixture.conversation.submit(FIXED_EVENT_TURNS[1]);
    const turn = kind === 'handoff' ? await fixture.conversation.submit(FIXED_EVENT_TURNS[2]) : first;
    if (kind !== 'handoff') {
      expect(turn.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
    } else {
      expect(turn.result?.state.lastQuestionContext).toBeUndefined();
      expect(turn.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
      expect(turn.result?.message).toContain('予定を追加');
    }
    expect(turn.result?.message).not.toMatch(/作業|学習タスク|schedulable_work|task identity/u);
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
    expect(turn.result?.failure).toBeUndefined();
    const calls = turn.calls.filter(call => call.kind === 'renderer');
    expect(calls).toHaveLength(1);
    expect(calls[0].payload!.actionId).toBe('a1');
    const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
    expect(trace.actionId).not.toBe('a1');
    expect(trace.actionId).toContain(CONVERSATION);
    expect(trace.response.status).toBe('rendered');
    expect(trace.response.reason).toBeNull();
    expect(JSON.parse(trace.response.rawResponse!).actionId).toBe('a1');
    const context = trace.request!.promptContext as Json;
    expect(context.messages).toEqual(calls[0].messages);
    expect(context.responseFormat).toEqual(calls[0].request.response_format);
    expect(context.actionBinding).toEqual({ token: 'a1', actionId: trace.actionId });
    const actualRequest = JSON.parse(calls[0].messages.find(message => message.role === 'user')!.content);
    expect(actualRequest.request).toContain('Wording follows typed purpose, never raw text');
    if (kind === 'question') {
      expect(actualRequest.request).toContain('confirm_existing_schedule=「どんな予定がありますか？」');
      expect(actualRequest.request).toContain('register_event=「どんな予定を入れたいですか？」');
      expect(actualRequest.request).toContain('identify_study_work/identify_work_to_schedule=「何を勉強したいですか？」');
    } else if (kind === 'handoff') {
      expect(actualRequest.request).toContain('fixed_event_manual_entry:');
      expect(actualRequest.request).not.toContain('confirm_existing_schedule=');
    } else {
      expect(actualRequest.applicationDecision.questionIntent).toMatchObject({ kind: 'schedulable_work_detail', mode: 'existing_target_progress' });
      expect(actualRequest.request).toContain('existing_target_progress=現在進捗のみ');
      expect(actualRequest.request).not.toContain('missing_task_identity=');
    }
    expect(actualRequest.applicationDecision.communication).toMatchObject(kind === 'question'
      ? { askQuestion: true, questionPurposes: ['clarify_schedule_request'] }
      : kind === 'study' ? { askQuestion: true, questionPurposes: ['skip_already_finished_work'] }
        : { askQuestion: false, statusReason: 'fixed_event_manual_entry' });
    expect(fixture.conversation.graph()!.tasks).toHaveLength(kind === 'question' ? 0 : 1);
    expect(fixture.conversation.graph()!.workloads).toEqual([]);
    const binding = context.actionBinding as Json;
    binding.futureField = SENTINEL;
    const input = {
      userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: kind === 'handoff' ? FIXED_EVENT_TURNS[2] : userText,
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
              expect(serialized).toContain('ai_rendered');
              expect(serialized).toContain('Wording follows typed purpose, never raw text');
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
