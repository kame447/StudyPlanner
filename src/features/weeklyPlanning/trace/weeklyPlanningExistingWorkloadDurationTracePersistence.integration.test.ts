import { afterEach, expect, it } from 'vitest';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionDocument, conditionSetupDocument, conditionFollowupDocument } from '../testUtils/weeklyPlanningConditionPropagationFixture';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply, type ScriptedConversation } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession, WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';

type Json = Record<string, unknown>;
const OWNER = 'duration-reference-owner';
const CONVERSATION = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174040';
const SENTINEL = 'future-duration-public-reference';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let restoreStorage: () => void;
afterEach(() => { provider?.restore(); restoreStorage?.(); resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); });

it.each([false, true])('persists exact workload duration scope through retry/Worker/future fields (reread: %s)', async reread => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  let conversation: ScriptedConversation;
  let followupCalls = 0;
  let targetWorkloadId = '';
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null });
    if (call.payload?.userText === CONDITION_SETUP) return JSON.stringify(conditionSetupDocument());
    const document = conditionFollowupDocument(conversation.graph()!);
    const tasks = document.tasks as Json[];
    if (reread && followupCalls++ === 0) return JSON.stringify(conditionDocument({ planningIntent: 'update_plan', tasks: tasks.map(task => ({ ...task, effortEstimates: [], temporalConstraints: [] })) }));
    const research = tasks.find(task => (task.effortEstimates as unknown[]).length > 0)!;
    targetWorkloadId = conversation.graph()!.workloads.find(workload => workload.taskId === research.existingPublicId)!.id;
    ((research.effortEstimates as Json[])[0]).targetLocalId = targetWorkloadId;
    return JSON.stringify(document);
  });
  conversation = createScriptedConversation({ provider, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1' });
  await conversation.submit(CONDITION_SETUP);
  await conversation.submit(CONDITION_PACE);
  const turn = await conversation.submit(CONDITION_FOLLOWUP);
  expect(turn.result?.failure).toBeUndefined();
  expect(conversation.graph()!.effortEstimates.find(estimate => estimate.kind === 'session_duration')?.targetFactId).toBe(targetWorkloadId);
  expect(turn.result?.draftCandidates).toHaveLength(3);
  expect(JSON.stringify(turn.debugTrace)).toContain('active-workload-duration-reference-projected');
  expect(turn.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(reread ? 2 : 1);
  const providerRequest = turn.debugTrace.find(event => event.stage === 'semantic_provider_request')!.data as { request: { messages: unknown }; requestBytes: number };
  expect(providerRequest.request.messages).toEqual(turn.calls.find(call => call.kind === 'semantic_generic')!.messages);
  const events = structuredClone(turn.debugTrace);
  const candidates = (events.find(event => event.stage === 'runtime_preview_scheduler_evaluated')!.data as Json).candidates as Json[];
  candidates[0].futureDurationField = SENTINEL;
  const kept = { userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: CONDITION_FOLLOWUP,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, debugTraceEvents: events,
    outcome: 'preview', previewCount: 3 };
  const oversized = structuredClone(kept);
  oversized.requestId = `${CONVERSATION}:oversized`;
  (((oversized.debugTraceEvents.find(event => event.stage === 'runtime_preview_scheduler_evaluated')!.data as Json).candidates as Json[])[0]).futureLargeValue = '大'.repeat(30_000);
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) { if (fail) { fail = false; throw new Error('duration trace append failed'); } writes.push(structuredClone(params)); },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(kept);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace(oversized);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
  expect(writes).toHaveLength(2);
  for (const [index, write] of writes.entries()) {
    const original = write.entries[0] as WeeklyPlanningTraceTurnDiagnosticEntry;
    expect(measureWeeklyPlanningTraceJsonBytes(original)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json, entries: write.entries as unknown as Json[] },
      { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, { sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174040', logicalConversationId: CONVERSATION }, '2026-10-07T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const persisted of [original, prepared.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry]) {
      expect(persisted.constraintContext.scheduler?.preview?.candidateCount).toBe(3);
      if (index === 0) {
        expect(persisted.aiInterpreter.input.requests).toHaveLength(reread ? 2 : 1);
        expect(persisted.aiInterpreter.input.requests[0].requestBytes).toBe(providerRequest.requestBytes);
        expect(JSON.stringify(persisted.aiInterpreter)).toContain(CONDITION_FOLLOWUP);
        expect(JSON.stringify(persisted.aiInterpreter.rawResponses)).toContain(targetWorkloadId);
        const parsed = persisted.aiInterpreter.structuredResults[persisted.aiInterpreter.structuredResults.length - 1].structuredResult as Json;
        const estimates = (parsed.tasks as Json[]).flatMap(task => task.effortEstimates as Json[]);
        // The existing transport stores initial validation only; accepted reread
        // visibility is a separate parent-owned follow-up, without new fields.
        expect(estimates).toEqual(reread ? [] : [expect.objectContaining({ kind: 'session_duration', minutes: 60, targetLocalId: 'existing-1' })]);
        const raw = JSON.parse(persisted.aiInterpreter.rawResponses[persisted.aiInterpreter.rawResponses.length - 1].text) as Json;
        const rawEstimates = (raw.tasks as Json[]).flatMap(task => task.effortEstimates as Json[]);
        expect(rawEstimates).toEqual([expect.objectContaining({ kind: 'session_duration', minutes: 60, targetLocalId: targetWorkloadId })]);
        expect(persisted.constraintContext.scheduler?.preview?.representativeCandidates.filter(candidate =>
          (candidate as Json).durationMinutes === 60)).toHaveLength(2);
        expect(JSON.stringify(persisted.constraintContext.scheduler?.preview?.representativeCandidates)).toContain(SENTINEL);
      } else {
        expect(JSON.stringify(persisted)).toMatch(/traceTruncated|traceProjectionTruncated|truncated/u);
        expect(JSON.stringify(persisted)).not.toContain('大'.repeat(30_000));
      }
    }
  }
}, 20_000);
