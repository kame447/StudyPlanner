import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { A, G, schedulingDocument, type Json } from '../testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { liveATemporalDocument, taskTemporalPreferenceDocument } from '../testUtils/weeklyPlanningLiveTemporalFixture';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession, WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';

const USER_ID = 'owner-temporal-repair';
const CONVERSATION_ID = 'weekly-conversation-733e4567-e89b-42d3-a456-426614174010';
const SENTINEL = 'future-temporal-repair-field';
let restoreStorage: () => void;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let scenario: 'date_repair' | 'task_preference' | 'hard_available';

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  scenario = 'date_repair';
  let calls = 0;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '候補が1件できました。「この内容で仮予定にする」を押してください。');
    const response = scenario === 'task_preference' ? taskTemporalPreferenceDocument()
      : scenario === 'hard_available' ? liveATemporalDocument() : schedulingDocument('G');
    if (scenario === 'hard_available') Object.assign((response.availabilityDeclarations as Json[])[0], { kind: 'available', constraintLevel: 'hard' });
    if (scenario === 'date_repair' && calls++ === 0) (response.availabilityDeclarations as Json[])[0].dateExpression = '火曜';
    return JSON.stringify(response);
  });
});

afterEach(() => {
  provider.restore();
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage();
});

describe('temporal constraint trace persistence gate', () => {
  it.each(['date_repair', 'task_preference', 'hard_available'] as const)('keeps %s requests, constraints and allocation through durable retry and Worker preparation', async (selected) => {
    scenario = selected;
    const isG = scenario === 'date_repair';
    const userText = isG ? G : A;
    const conversation = createScriptedConversation({
      provider, ownerId: USER_ID, conversationId: CONVERSATION_ID,
      weekStartDate: isG ? '2026-10-12' : '2026-10-05',
      now: () => isG ? '2026-10-13T11:00:00.000Z' : '2026-10-07T09:00:00.000Z',
    });
    const turn = await conversation.submit(userText);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(isG ? 2 : 1);
    expect(turn.result?.draftCandidates).toHaveLength(1);
    const candidate = turn.result!.draftCandidates[0];
    if (isG) {
      expect(candidate.date <= '2026-10-16').toBe(true);
      expect(candidate.date > '2026-10-13' || candidate.startTime >= '22:00').toBe(true);
    } else {
      expect(candidate).toMatchObject({ date: '2026-10-12', startTime: '20:00', endTime: '21:10' });
    }
    expect(candidate.durationMinutes).toBe(70);
    const events = structuredClone(turn.debugTrace);
    const preview = events.find((event) => event.stage === 'runtime_preview_scheduler_evaluated')!;
    expect(preview).toBeDefined();
    ((preview.data as Json).candidates as Json[])[0].futureTemporalRepairField = SENTINEL;
    const first = {
      userId: USER_ID, conversationId: CONVERSATION_ID, requestId: turn.requestId!, userText,
      assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
      outcome: 'scheduler_ready', previewCount: 1, debugTraceEvents: events,
    };

    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let failNext = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(params) {
        if (failNext) { failNext = false; throw new Error('injected temporal repair trace append failure'); }
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
    ((largePreview.data as Json).candidates as Json[])[0].futureLargeRepairField = '日時修復'.repeat(30_000);
    await recordWeeklyPlanningStableV5TurnTrace(oversized);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER_ID, conversationId: CONVERSATION_ID })).toEqual([]);
    expect(writes).toHaveLength(2);

    for (const [index, write] of writes.entries()) {
      const entry = write.entries[0] as WeeklyPlanningTraceTurnDiagnosticEntry;
      expect(entry.kind).toBe('turn_diagnostic');
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: write.session as unknown as Json, entries: write.entries as unknown as Json[],
      }, { token: `wpt_${'f'.repeat(43)}`, epoch: '107' }, {
        sessionId: 'weekly-trace-733e4567-e89b-42d3-a456-426614174010', logicalConversationId: CONVERSATION_ID,
      }, '2026-10-13T11:00:00.000Z');
      expect(prepared.entries).toHaveLength(1);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      for (const persisted of [entry, prepared.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry]) {
        expect(persisted.constraintContext.scheduler?.preview?.candidateCount).toBe(1);
        if (index === 0) {
          const interpreter = JSON.stringify(persisted.aiInterpreter);
          expect(interpreter).toContain(userText);
          if (isG) {
            expect(interpreter).toContain('canonical-expression');
            expect(interpreter).toContain('weekday:tuesday');
            expect(interpreter).toContain('2026-10-16');
          } else {
            expect(interpreter).toContain(scenario === 'task_preference' ? 'preferred_window' : 'available');
            expect(interpreter).toContain('20:00');
          }
          expect(persisted.aiInterpreter.input.requests).toHaveLength(isG ? 2 : 1);
          expect(persisted.constraintContext.scheduler?.preview?.representativeCandidates).toEqual([
            expect.objectContaining({ durationMinutes: 70, futureTemporalRepairField: SENTINEL }),
          ]);
        } else {
          expect(JSON.stringify(persisted)).toMatch(/traceProjectionTruncated|traceTruncated|truncated/u);
          expect(JSON.stringify(persisted)).not.toContain('日時修復'.repeat(30_000));
        }
      }
    }
  });
});
