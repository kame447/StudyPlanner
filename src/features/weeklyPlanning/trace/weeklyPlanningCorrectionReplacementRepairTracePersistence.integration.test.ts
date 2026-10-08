import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, expect, it } from 'vitest';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { correctionReplacementRepairFixture, REPLACEMENT_REPLY_TEXT } from '../testUtils/weeklyPlanningCorrectionReplacementRepairFixture';
import { resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';
import { prepareWeeklyPlanningStableV5Checkpoint, parseWeeklyPlanningStableV5PersistedSession, serializeWeeklyPlanningStableV5CheckpointWithMessageCount } from '../application/weeklyPlanningStableV5SessionCodec';

type Json = Record<string, unknown>;
const SENTINEL = 'future-correction-repair-field';
let fixture: ReturnType<typeof correctionReplacementRepairFixture>;
let restore: () => void;
afterEach(() => {
  fixture?.provider.restore();
  restore?.();
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
});

it('persists actual unknown-replacement repair guidance through outbox retry and Worker with future fields and truncation', async () => {
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  fixture = correctionReplacementRepairFixture('include');
  const { conversation } = fixture;
  await fixture.setup();
  const old = structuredClone(conversation.graph()!);
  const answer = await conversation.submit(REPLACEMENT_REPLY_TEXT);
  expect(answer.result?.failure).toBeUndefined();
  const checkpointParams = {
    ownerId: conversation.ownerId, conversationId: conversation.conversationId,
    weekStartDate: conversation.weekStartDate, graph: conversation.graph()!, planningState: conversation.getState(),
  };
  const checkpoint = prepareWeeklyPlanningStableV5Checkpoint(checkpointParams);
  expect(checkpoint.status).toBe('ready');
  if (checkpoint.status !== 'ready') throw new Error('expected a restorable correction repair checkpoint');
  const raw = serializeWeeklyPlanningStableV5CheckpointWithMessageCount({
    ...checkpointParams, planningState: checkpoint.planningState,
    savedAt: '2026-10-07T09:00:00Z', messageCount: checkpoint.planningState.messages.length,
  });
  expect(raw).not.toBeNull();
  const restored = parseWeeklyPlanningStableV5PersistedSession({
    raw: raw!, ownerId: conversation.ownerId, weekStartDate: conversation.weekStartDate,
  });
  expect(restored).not.toBeNull();
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(restored!.graph);
  expect(restored!.graph.workloads).toEqual(old.workloads);
  expect(active.workloads).toEqual(createWeeklyPlanningActiveSchedulerGraphViewV5(old).workloads);
  expect(active.temporalConstraints).toContainEqual(expect.objectContaining({ kind: 'deadline', dateExpression: '2026-10-16' }));
  expect(restored!.planningState.previewCandidates!.length).toBeGreaterThan(0);

  const turnInput = (turn: typeof answer) => ({
    userId: conversation.ownerId, conversationId: conversation.conversationId,
    requestId: turn.requestId!, userText: REPLACEMENT_REPLY_TEXT,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
    outcome: turn.result!.draftCandidates.length ? 'preview' : 'question',
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!),
    debugTraceEvents: turn.debugTrace, previewCount: turn.result!.draftCandidates.length,
  });
  const inputs = [turnInput(answer)];
  const context = inputs[0].dialogueRendererTrace.request!.promptContext as Json;
  expect(context.messages).toEqual(answer.calls.find((call) => call.kind === 'renderer')!.messages);
  const extended = structuredClone(inputs[0]);
  extended.requestId = `${conversation.conversationId}:request:future`;
  const extendRepairRequest = (input: typeof extended, value: string) => {
    const event = input.debugTraceEvents.find(event => event.stage === 'semantic_provider_request' && (event.data as { attempt?: string }).attempt === 'repair')!;
    const data = event.data as { request: { messages: Array<{ role: string; content: string }> }; requestBytes: number };
    const user = data.request.messages[data.request.messages.length - 1];
    const payload = JSON.parse(user.content) as Json;
    payload.futureCorrectionRepairField = value;
    user.content = JSON.stringify(payload);
    data.requestBytes = new TextEncoder().encode(JSON.stringify(data.request)).byteLength;
  };
  extendRepairRequest(extended, SENTINEL);
  const large = structuredClone(extended);
  large.requestId = `${conversation.conversationId}:request:oversized`;
  extendRepairRequest(large, 'あ'.repeat(30_000));
  inputs.push(extended, large);

  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) {
      if (fail) { fail = false; throw new Error('first correction trace write failed'); }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {},
    async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(inputs[0]);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId: conversation.conversationId })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  for (const input of inputs.slice(1)) await recordWeeklyPlanningStableV5TurnTrace(input);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId: conversation.conversationId })).toEqual([]);
  const entries = writes.flatMap((write) => write.entries);
  expect(entries).toHaveLength(inputs.length);
  const prepared = writes.flatMap((write) => prepareWeeklyPlanningTraceServerWrite({
    session: write.session as unknown as Json, entries: write.entries as unknown as Json[],
  }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, {
    sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174000', logicalConversationId: conversation.conversationId,
  }, '2026-10-07T00:00:00Z').entries);
  for (const entry of entries) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  for (const entry of prepared) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  for (const set of [entries, prepared]) {
    const byRequest = (id: string) => JSON.stringify(set.find((entry) => (entry as unknown as Json).requestId === id));
    const answerEntry = set.find(entry => (entry as unknown as Json).requestId === answer.requestId)! as unknown as {
      aiInterpreter: { rawResponses: Array<{ text: string }> };
    };
    expect(answerEntry.aiInterpreter.rawResponses).toHaveLength(2);
    expect(byRequest(answer.requestId!)).toContain('replacementLocalId:unknown:timing');
    expect(byRequest(answer.requestId!)).toContain('referenced correction.replacementLocalId');
    expect(byRequest(answer.requestId!)).toContain('drop the correction if no change is meant');
    expect(byRequest(answer.requestId!)).toContain('2026-10-16');
    expect(byRequest(extended.requestId)).toContain(SENTINEL);
    expect(byRequest(large.requestId)).toMatch(/traceProjectionTruncated|traceTruncatedItems|truncated/u);
    expect(byRequest(large.requestId)).not.toContain('あ'.repeat(30_000));
  }
});
