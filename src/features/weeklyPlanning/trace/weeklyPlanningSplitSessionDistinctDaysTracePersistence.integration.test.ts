import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  type ScriptedConversation, type ScriptedConversationTurn,
} from '../testUtils/weeklyPlanningScriptedConversationHarness';
import {
  CAMPAIGN, campaignProviderReply, type CampaignRequest,
} from '../testUtils/weeklyPlanningRealE2ECampaignFixture';
import type { Json } from '../testUtils/weeklyPlanningSchedulingConstraintsFixture';
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

const USER = 'split-session-days-trace-owner';
const CONVERSATION = 'weekly-conversation-723e4567-e89b-42d3-a456-426614174001';
const SENTINEL = 'future-split-session-days-488';
let restoreStorage: () => void;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let conversation: ScriptedConversation;

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  provider = installScriptedWeeklyPlanningProvider(call => {
    const reply = campaignProviderReply('E', call.request as unknown as CampaignRequest);
    if (call.kind !== 'semantic_generic' || call.payload?.userText !== CAMPAIGN.E[2]) return reply;
    const document = JSON.parse(reply) as Json;
    const task = (document.tasks as Json[])[0];
    task.temporalConstraints = [];
    task.recurrence = [{ localId: 'weekend-sessions', targetLocalId: String(task.localId), kind: 'weekends',
      count: null, days: ['weekday:saturday', 'weekday:sunday'], sourceText: '土日にまとめたい' }];
    return JSON.stringify(document);
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
    userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: CAMPAIGN.E[2],
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!),
    outcome: 'preview', previewCount: 2, debugTraceEvents: turn.debugTrace,
  };
}

describe('split-session distinct-day trace persistence gate', () => {
  it('preserves actual separate-day candidates through outbox retry, Worker and explicit size truncation', async () => {
    await conversation.submit(CAMPAIGN.E[0]);
    const turn = await conversation.submit(CAMPAIGN.E[2]);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
    expect(turn.result?.draftCandidates?.map(candidate => [candidate.date, candidate.durationMinutes]))
      .toEqual([['2026-10-17', 90], ['2026-10-18', 90]]);
    const semantic = turn.calls.find((call) => call.kind === 'semantic_generic')!;
    const requestEvent = turn.debugTrace.find((event) => event.stage === 'semantic_provider_request')!;
    const actualRequest = requestEvent.data as { request: { messages: unknown }; requestBytes: number };
    expect(actualRequest.request.messages).toEqual(semantic.messages);
    const sessionId = conversation.graph()!.effortEstimates.find((estimate) => estimate.kind === 'session_duration')!.id;
    const scheduler = turn.debugTrace.find((event) => event.stage === 'runtime_preview_scheduler_evaluated')!;
    const data = scheduler.data as Record<string, unknown>;
    expect(data.candidateCount).toBe(2);
    const candidates = data.candidates as Record<string, unknown>[];
    expect(candidates.filter((item) => String(item.title).includes('卒業研究ノート'))).toHaveLength(2);
    expect(JSON.stringify(candidates)).toContain(sessionId);

    expect(candidates.map(candidate => [candidate.date, candidate.durationMinutes]))
      .toEqual([['2026-10-17', 90], ['2026-10-18', 90]]);
    const renderer = turn.calls.find(call => call.kind === 'renderer')!;
    const input = traceInput(turn);
    const context = input.dialogueRendererTrace.request!.promptContext as Record<string, unknown>;
    expect(context.messages).toEqual(renderer.messages);
    const kept = structuredClone(input);
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
        sessionId: 'weekly-trace-723e4567-e89b-42d3-a456-426614174001', logicalConversationId: CONVERSATION,
      }, '2026-10-07T00:00:00.000Z');
      for (const entry of write.entries) {
        const workerEntry = prepared.entries.find((candidate) => candidate.requestId === entry.requestId)!;
        expect(workerEntry).toBeDefined();
        expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        expect(measureWeeklyPlanningTraceJsonBytes(workerEntry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        for (const persisted of [entry, workerEntry]) {
          const text = JSON.stringify(persisted);
          expect(text).toContain('session_duration');
          expect(text).toContain('weekends');
          expect(text).toContain('2026-10-17');
          expect(text).toContain('2026-10-18');
          expect(text).toContain('卒業研究ノート');
          expect(text).toContain(sessionId);
          expect(text).toContain(SENTINEL);
          expect(text).toContain('previewConstraintSatisfaction');
          if (entry.requestId === kept.requestId) {
            const diagnostic = persisted as WeeklyPlanningTraceTurnDiagnosticEntry;
            const request = diagnostic.aiInterpreter.input.requests[0];
            expect(request.requestBytes).toBe(actualRequest.requestBytes);
            expect(request.messages.find((message) => message.role === 'user')?.content).toContain(CAMPAIGN.E[2]);
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
