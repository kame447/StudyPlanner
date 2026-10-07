import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { A, schedulingDocument, type Json } from '../testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession, WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';

const USER_ID = 'owner-scheduling-constraints';
const CONVERSATION_ID = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174010';
const SENTINEL = 'future-scheduling-preference-field';
let restoreStorage: () => void;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  provider = installScriptedWeeklyPlanningProvider((call) => call.kind === 'renderer'
    ? scriptedRendererReply(call, '候補が1件できました。「この内容で仮予定にする」を押してください。')
    : JSON.stringify(schedulingDocument('A')));
});

afterEach(() => {
  provider.restore();
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage();
});

describe('scheduling constraints trace persistence gate', () => {
  it('persists the real accepted week/preference and resulting 70-minute evening preview through retry and Worker bounds', async () => {
    const conversation = createScriptedConversation({ provider, ownerId: USER_ID, conversationId: CONVERSATION_ID });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '20:00', endTime: '21:10', durationMinutes: 70 }),
    ]);
    const semanticRequest = turn.calls.find((call) => call.kind === 'semantic_generic')!;
    expect(semanticRequest.payload?.userText).toBe(A);
    const events = structuredClone(turn.debugTrace);
    const preview = events.find((event) => event.stage === 'runtime_preview_scheduler_evaluated')!;
    expect(preview).toBeDefined();
    const candidates = (preview.data as Json).candidates as Json[];
    expect(candidates[0]).toMatchObject({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 });
    candidates[0].futurePreferenceField = SENTINEL;

    const first = {
      userId: USER_ID, conversationId: CONVERSATION_ID, requestId: turn.requestId!, userText: A,
      assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
      outcome: 'scheduler_ready', previewCount: 1, debugTraceEvents: events,
    };
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let failNext = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(params) {
        if (failNext) { failNext = false; throw new Error('injected scheduling trace append failure'); }
        writes.push(structuredClone(params));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    await recordWeeklyPlanningStableV5TurnTrace(first);
    expect(writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER_ID, conversationId: CONVERSATION_ID })).toHaveLength(1);

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    const oversized = structuredClone(first);
    oversized.requestId = `${CONVERSATION_ID}:request:oversized`;
    const largePreview = oversized.debugTraceEvents.find((event) => event.stage === preview.stage)!;
    ((largePreview.data as Json).candidates as Json[])[0].futureLargePreferenceField = '拡張値'.repeat(30_000);
    await recordWeeklyPlanningStableV5TurnTrace(oversized);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER_ID, conversationId: CONVERSATION_ID })).toEqual([]);
    expect(writes).toHaveLength(2);

    for (const [index, write] of writes.entries()) {
      const entry = write.entries[0] as WeeklyPlanningTraceTurnDiagnosticEntry;
      expect(entry.kind).toBe('turn_diagnostic');
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: write.session as unknown as Json, entries: write.entries as unknown as Json[],
      }, { token: `wpt_${'f'.repeat(43)}`, epoch: '106' }, {
        sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174010', logicalConversationId: CONVERSATION_ID,
      }, '2026-10-07T10:00:00.000Z');
      expect(prepared.entries).toHaveLength(1);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      for (const persisted of [entry, prepared.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry]) {
        expect(persisted.constraintContext.scheduler?.preview?.candidateCount).toBe(1);
        if (index === 0) {
          expect(persisted.aiInterpreter.input.userText).toBe(A);
          const requestText = JSON.stringify(persisted.aiInterpreter.input.requests);
          expect(requestText).toContain(A);
          expect(JSON.stringify(persisted.aiInterpreter.structuredResults)).toContain('next_week');
          expect(JSON.stringify(persisted.aiInterpreter.structuredResults)).toContain('preferred');
          expect(persisted.constraintContext.scheduler?.preview?.representativeCandidates).toEqual([
            expect.objectContaining({ date: '2026-10-12', startTime: '20:00', endTime: '21:10', durationMinutes: 70, futurePreferenceField: SENTINEL }),
          ]);
        } else {
          expect(JSON.stringify(persisted)).toMatch(/traceProjectionTruncated|traceTruncated|truncated/u);
          expect(JSON.stringify(persisted)).not.toContain('拡張値'.repeat(30_000));
        }
      }
    }
  });
});
