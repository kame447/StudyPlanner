import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply, eventStudyTask } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository } from './weeklyPlanningTraceTypes';

type Json = Record<string, unknown>;
const USER = 'r28-trace-owner';
const CONVERSATION = 'weekly-conversation-9c753879-159c-4eea-832f-8d59e90e8991';
const SENTINEL = 'future-retained-preview-evidence';
const INITIAL = '来週、数学を20分勉強する';
const CONSULT = '週末にまとめるのはどう？';
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

describe('R28 renderer evidence at the actual trace persistence boundary', () => {
  it.each(['alternative', 'recovery', 'ordinary', 'legacy'] as const)('persists %s presence/absence, repair and flags through outbox/Worker/bounds', async kind => {
    let phase: 'initial' | 'alternative' | 'recovery' = 'initial';
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') {
        if (phase === 'initial') return eventRendererReply(call);
        if (phase === 'recovery') return '{invalid-renderer-json';
        return JSON.stringify({ ...JSON.parse(scriptedRendererReply(call,
          '今の候補でよければ「この内容で仮予定にする」を押してください。')), feasibilityClaim: 'fits' });
      }
      if (phase === 'recovery') return '{invalid-semantic-json';
      if (phase === 'initial') return JSON.stringify(eventDocument({ planningIntent: 'create_plan', planningWindow: {
        localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週',
      }, tasks: [eventStudyTask()], ...(kind === 'legacy' ? {} : { conversationActs: [] }) }));
      const tasks = (call.payload!.publicStateSummary as Json).tasks as Json[];
      return JSON.stringify(eventDocument({ conversationActs: [{ kind: 'consultation_request', targetPublicId: tasks[0].publicId,
        placementAlternative: { scope: 'task', dateExpressions: ['weekday:saturday', 'weekday:sunday'], sourceText: CONSULT },
      }] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: kind === 'legacy' ? 'legacy_v5' : 'interaction_v1',
      ownerId: USER, conversationId: CONVERSATION, weekStartDate: '2030-01-07', now: () => '2030-01-01T00:00:00.000Z' });
    const first = await conversation.submit(INITIAL);
    phase = kind === 'alternative' ? 'alternative' : kind === 'recovery' ? 'recovery' : 'initial';
    const userText = kind === 'alternative' ? CONSULT : kind === 'recovery' ? '締切を変えたい' : INITIAL;
    const turn = kind === 'ordinary' || kind === 'legacy' ? first : await conversation.submit(userText);
    const rendererCalls = turn.calls.filter(call => call.kind === 'renderer');
    expect(rendererCalls).toHaveLength(kind === 'alternative' ? 2 : 1);
    const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
    const context = trace.request!.promptContext as Json;
    expect(context.messages).toEqual(rendererCalls[0].messages);
    const request = JSON.parse(rendererCalls[0].messages.find(message => message.role === 'user')!.content);
    const communication = request.applicationDecision.communication;
    if (kind === 'alternative') {
      expect(communication).toMatchObject({ alternativeRequiresAdoption: true });
      expect(context.repair).toMatchObject({ reason: 'unadopted_alternative_promotion' });
      expect(trace.response).toMatchObject({ status: 'fallback', reason: 'unadopted_alternative_promotion' });
    } else if (kind === 'recovery') {
      expect(communication).toMatchObject({ retainedPreviewUnchanged: true, askQuestion: false });
      expect(trace.response.status).toBe('fallback');
    } else {
      expect(communication?.alternativeRequiresAdoption).toBeUndefined();
      expect(communication?.retainedPreviewUnchanged).toBeUndefined();
      if (kind === 'legacy') expect(request.applicationDecision).not.toHaveProperty('communication');
    }
    // Only the two derived presentation flags leave the client; placements remain private input.
    expect(request).not.toHaveProperty('currentPreview');
    expect(JSON.stringify(request)).not.toContain('"currentPreview":');
    context.futureRendererProjection = SENTINEL;
    const input = { userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText,
      assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
      dialogueRendererTrace: trace, outcome: kind === 'recovery' ? 'failure' : 'revision_pending', previewCount: 0,
      debugTraceEvents: turn.debugTrace };
    const oversized = structuredClone(input);
    oversized.requestId = `${CONVERSATION}:oversized`;
    (oversized.dialogueRendererTrace.request!.promptContext as Json).futureLargeProjection = '大'.repeat(50_000);
    oversized.dialogueRendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(oversized.dialogueRendererTrace);
    const entries: WeeklyPlanningTraceEntry[] = [];
    let failOnce = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(write) {
        if (failOnce) { failOnce = false; throw new Error('synthetic first trace append failure'); }
        const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json,
          entries: write.entries as unknown as Json[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '107' }, {
          sessionId: 'weekly-trace-9c753879-159c-4eea-832f-8d59e90e8991', logicalConversationId: CONVERSATION,
        }, '2030-01-01T00:00:00.000Z');
        for (const entry of write.entries) {
          expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
          const worker = prepared.entries.find(candidate => candidate.requestId === entry.requestId)!;
          expect(measureWeeklyPlanningTraceJsonBytes(worker)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
          for (const persisted of [entry, worker]) {
            expect(persisted.kind).toBe('turn_diagnostic');
            if (entry.requestId === input.requestId) {
              const renderer = ((persisted as unknown as Json).diagnostics as Json).dialogueRenderer as typeof trace;
              expect(renderer.request!.promptContext).toEqual(context);
              expect(renderer.response.rawResponse).toBe(trace.response.rawResponse);
              expect(JSON.stringify(persisted)).toContain(SENTINEL);
              const actual = JSON.parse((renderer.request!.promptContext as { messages: Array<{ role: string; content: string }> }).messages.find(message => message.role === 'user')!.content);
              expect(actual.applicationDecision.communication).toEqual(communication);
              expect(actual).not.toHaveProperty('currentPreview');
              expect(JSON.stringify(actual)).not.toContain('"currentPreview":');
            } else {
              expect(JSON.stringify(persisted)).toMatch(/truncated|Truncated/u);
              expect(JSON.stringify(persisted)).not.toContain('大'.repeat(50_000));
            }
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
    const pending = listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION });
    expect(pending).toHaveLength(1);
    expect(pending[0].input.dialogueRendererTrace!.request!.promptContext).toEqual(context);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(oversized);
    expect(entries).toHaveLength(2);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(0);
  });
});
