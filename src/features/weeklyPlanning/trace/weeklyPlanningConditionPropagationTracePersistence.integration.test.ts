import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  type ScriptedConversation, type ScriptedConversationTurn,
} from '../testUtils/weeklyPlanningScriptedConversationHarness';
import {
  CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionSetupDocument, conditionFollowupDocument,
} from '../testUtils/weeklyPlanningConditionPropagationFixture';
import { declaration } from '../testUtils/weeklyPlanningSchedulingConstraintsFixture';
import {
  recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type {
  WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';

const USER = 'session-propagation-trace-owner';
const CONVERSATION = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174001';
const SENTINEL = 'future-session-propagation-488';
let restoreStorage: () => void;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let conversation: ScriptedConversation;
let morningOnly = false;

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  morningOnly = false;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return 'renderer unavailable in fixture';
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({
      decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
      minutes: 3, precision: 'approximate', quantityRole: null,
    });
    return JSON.stringify(String(call.payload?.userText) === CONDITION_SETUP ? conditionSetupDocument()
      : { ...conditionFollowupDocument(conversation.graph()!), ...(morningOnly ? { availabilityDeclarations: [declaration({
        kind: 'available', startTime: '09:00', endTime: '12:00', recurrenceKind: 'daily',
        constraintLevel: 'hard', sourceText: '使えるのは毎日9時から12時だけ',
      })] } : {}) });
  });
  conversation = createScriptedConversation({ provider, ownerId: USER, conversationId: CONVERSATION, architecture: 'interaction_v1' });
});
afterEach(() => {
  provider.restore();
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage();
});

function traceInput(turn: ScriptedConversationTurn) {
  return {
    userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: CONDITION_FOLLOWUP,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!),
    outcome: 'preview', previewCount: 3, debugTraceEvents: turn.debugTrace,
  };
}

describe('session-size propagation trace persistence gate', () => {
  it.each([false, true])('persists actual request, preview and constraint truth through outbox/Worker/size limits (morning only: %s)', async limited => {
    await conversation.submit(CONDITION_SETUP);
    await conversation.submit(CONDITION_PACE);
    morningOnly = limited;
    const turn = await conversation.submit(`${CONDITION_FOLLOWUP}${limited ? '。使えるのは毎日9時から12時だけ' : ''}`);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toHaveLength(3);
    const semantic = turn.calls.find((call) => call.kind === 'semantic_generic')!;
    const requestEvent = turn.debugTrace.find((event) => event.stage === 'semantic_provider_request')!;
    const actualRequest = requestEvent.data as { request: { messages: unknown }; requestBytes: number };
    expect(actualRequest.request.messages).toEqual(semantic.messages);
    const sessionId = conversation.graph()!.effortEstimates.find((estimate) => estimate.kind === 'session_duration')!.id;
    const scheduler = turn.debugTrace.find((event) => event.stage === 'runtime_preview_scheduler_evaluated')!;
    const data = scheduler.data as Record<string, unknown>;
    expect(data.candidateCount).toBe(3);
    const candidates = data.candidates as Record<string, unknown>[];
    expect(candidates.filter((item) => String(item.title).includes('卒業研究ノート'))).toHaveLength(2);
    expect(JSON.stringify(candidates)).toContain(sessionId);

    const renderer = turn.calls.find(call => call.kind === 'renderer')!;
    const communication = (renderer.payload!.applicationDecision as Record<string, unknown>).communication as Record<string, unknown>;
    const satisfaction = communication.previewConstraintSatisfaction as Array<Record<string, unknown>>;
    expect(satisfaction).toHaveLength(3);
    expect(satisfaction.filter(fact => fact.kind === 'preferred_window').map(fact => fact.status))
      .toEqual(limited ? ['not_satisfied', 'not_satisfied'] : ['satisfied', 'satisfied']);

    const input = traceInput(turn);
    const context = input.dialogueRendererTrace.request!.promptContext as Record<string, unknown>;
    expect(JSON.stringify(context)).toContain('previewConstraintSatisfaction');
    expect(context.messages).toEqual(renderer.messages);
    const contextMessages = context.messages as Array<{ role: string; content: string }>;
    const actualPayload = JSON.parse(contextMessages.find(message => message.role === 'user')!.content) as Record<string, unknown>;
    const actualCommunication = ((actualPayload.applicationDecision as Record<string, unknown>).communication as Record<string, unknown>);
    expect(actualCommunication.previewConstraintSatisfaction).toEqual(satisfaction);
    const kept = structuredClone(input);
    const keptContext = kept.dialogueRendererTrace.request!.promptContext as Record<string, unknown>;
    const keptMessages = keptContext.messages as Array<{ role: string; content: string }>;
    const keptUserMessage = keptMessages.find(message => message.role === 'user')!;
    const keptPayload = JSON.parse(keptUserMessage.content) as Record<string, unknown>;
    const keptCommunication = (keptPayload.applicationDecision as Record<string, unknown>).communication as Record<string, unknown>;
    (keptCommunication.previewConstraintSatisfaction as Array<Record<string, unknown>>)[0].futureConstraintTruth = 'future-constraint-truth-field';
    keptUserMessage.content = JSON.stringify(keptPayload);
    const keptScheduler = kept.debugTraceEvents.find((event) => event.stage === 'runtime_preview_scheduler_evaluated')!;
    const keptCandidates = (keptScheduler.data as Record<string, unknown>).candidates as Record<string, unknown>[];
    keptCandidates[1].futureSessionField = SENTINEL;
    const large = structuredClone(kept);
    large.requestId = `${CONVERSATION}:oversized`;
    const largeScheduler = large.debugTraceEvents.find((event) => event.stage === 'runtime_preview_scheduler_evaluated')!;
    ((largeScheduler.data as Record<string, unknown>).candidates as Record<string, unknown>[])[0].futureLargeField = '大'.repeat(30_000);

    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let failOnce = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(params) {
        if (failOnce) { failOnce = false; throw new Error('injected session propagation append failure'); }
        writes.push(structuredClone(params));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    await recordWeeklyPlanningStableV5TurnTrace(kept);
    expect(writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(large);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);
    expect(writes.flatMap((write) => write.entries)).toHaveLength(2);

    for (const write of writes) {
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: write.session as unknown as Record<string, unknown>, entries: write.entries as unknown as Record<string, unknown>[],
      }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, {
        sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174001', logicalConversationId: CONVERSATION,
      }, '2026-10-07T00:00:00.000Z');
      for (const entry of write.entries) {
        const workerEntry = prepared.entries.find((candidate) => candidate.requestId === entry.requestId)!;
        expect(workerEntry).toBeDefined();
        expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        expect(measureWeeklyPlanningTraceJsonBytes(workerEntry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        for (const persisted of [entry, workerEntry]) {
          const text = JSON.stringify(persisted);
          expect(text).toContain('session_duration');
          expect(text).toContain('night');
          expect(text).toContain('卒業研究ノート');
          expect(text).toContain(sessionId);
          expect(text).toContain(SENTINEL);
          expect(text).toContain('previewConstraintSatisfaction');
          expect(text).toContain('future-constraint-truth-field');
          if (limited) expect(text).toContain('not_satisfied');
          if (entry.requestId === kept.requestId) {
            const diagnostic = persisted as WeeklyPlanningTraceTurnDiagnosticEntry;
            const request = diagnostic.aiInterpreter.input.requests[0];
            expect(request.requestBytes).toBe(actualRequest.requestBytes);
            expect(request.messages.find((message) => message.role === 'user')?.content).toContain(CONDITION_FOLLOWUP);
            // Durable requests intentionally bound each message at 1500 bytes; prove the
            // actual request was recorded above, and require explicit metadata for the cut.
            expect(diagnostic.diagnostics.truncation?.fields.some((field) => field.includes('input.requests[0].messages'))).toBe(true);
          } else {
            expect(text).toMatch(/truncated|Truncated/u);
            expect(text).not.toContain('大'.repeat(30_000));
          }
        }
      }
    }
  });
});
