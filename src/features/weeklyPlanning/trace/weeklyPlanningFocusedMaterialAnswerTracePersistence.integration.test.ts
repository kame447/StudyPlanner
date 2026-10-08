import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, expect, it } from 'vitest';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { focusedMaterialConversationFixture, MATERIAL_SETUP as MATERIAL_SETUP_TEXT, MATERIAL_PACE as MATERIAL_RATE_TEXT, MATERIAL_WHY as MATERIAL_EXPLANATION_TEXT, MATERIAL_NAME, MATERIAL_MIXED } from '../testUtils/weeklyPlanningFocusedMaterialAnswerFixture';
import { resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';
import { prepareWeeklyPlanningStableV5Checkpoint, parseWeeklyPlanningStableV5PersistedSession, serializeWeeklyPlanningStableV5CheckpointWithMessageCount } from '../application/weeklyPlanningStableV5SessionCodec';

type Json = Record<string, unknown>;
const SENTINEL = 'future-focused-material-answer-field';
let fixture: ReturnType<typeof focusedMaterialConversationFixture>;
let restore: () => void;
afterEach(() => {
  fixture?.provider.restore();
  restore?.();
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
});

it.each([MATERIAL_NAME, MATERIAL_MIXED])('persists the focused contract and %s through checkpoint/outbox/Worker, retaining future fields within limits', async (answerText) => {
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  fixture = focusedMaterialConversationFixture({ conversationId: 'weekly-conversation-623e4567-e89b-42d3-a456-426614174000' });
  const { conversation } = fixture;
  await conversation.submit(MATERIAL_SETUP_TEXT);
  const old = structuredClone(conversation.graph()!);
  const explanation = await conversation.submit(MATERIAL_EXPLANATION_TEXT);
  expect(conversation.graph()).toEqual({ ...old,
    appliedTurnKeys: [...old.appliedTurnKeys, `${conversation.conversationId}:${explanation.requestId}`],
  });
  const rate = await conversation.submit(MATERIAL_RATE_TEXT);
  const answer = await conversation.submit(answerText);
  const checkpointParams = {
    ownerId: conversation.ownerId, conversationId: conversation.conversationId,
    weekStartDate: conversation.weekStartDate, graph: conversation.graph()!, planningState: conversation.getState(),
  };
  const checkpoint = prepareWeeklyPlanningStableV5Checkpoint(checkpointParams);
  expect(checkpoint.status).toBe('ready');
  if (checkpoint.status !== 'ready') throw new Error('expected a restorable material identity checkpoint');
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
  expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
  expect(active.workloads).toEqual([expect.objectContaining({ id: old.workloads[0].id, amount: 20, source: old.workloads[0].source })]);
  expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3, targetFactId: old.workloads[0].id }));
  expect(active.uncertainties).toEqual([]);
  expect(restored!.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: old.components[0].id, status: 'superseded' }));
  expect((restored!.planningState.previewCandidates ?? []).length, JSON.stringify({
    estimates: active.effortEstimates, question: restored!.planningState.intakeState?.lastQuestionContext,
    scheduler: answer.debugTrace.filter((event) => event.stage.includes('scheduler')).map((event) => event.data),
  })).toBeGreaterThan(0);
  expect(restored!.planningState.intakeState?.lastQuestionContext).toBeUndefined();

  const turnInput = (turn: typeof answer) => ({
    userId: conversation.ownerId, conversationId: conversation.conversationId,
    requestId: turn.requestId!, userText: turn === rate ? MATERIAL_RATE_TEXT : answerText,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
    outcome: turn.result!.draftCandidates.length ? 'preview' : 'question',
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!),
    debugTraceEvents: turn.debugTrace, previewCount: turn.result!.draftCandidates.length,
  });
  const inputs = [turnInput(rate), turnInput(answer)];
  const context = inputs[1].dialogueRendererTrace.request!.promptContext as Json;
  expect(context.messages).toEqual(answer.calls.find((call) => call.kind === 'renderer')!.messages);
  const extended = structuredClone(inputs[1]);
  extended.requestId = `${conversation.conversationId}:request:future`;
  const extendedContext = extended.dialogueRendererTrace.request!.promptContext as Json;
  const messages = extendedContext.messages as Array<{ role: string; content: string }>;
  const user = messages.find((message) => message.role === 'user')!;
  const payload = JSON.parse(user.content) as Json;
  (payload.applicationDecision as Json).futureMaterialIdentityAnswer = SENTINEL;
  user.content = JSON.stringify(payload);
  extendedContext.requestBytes = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
  const large = structuredClone(extended);
  large.requestId = `${conversation.conversationId}:request:oversized`;
  const largeContext = large.dialogueRendererTrace.request!.promptContext as Json;
  const largeMessages = largeContext.messages as Array<{ role: string; content: string }>;
  const largeUser = largeMessages.find((message) => message.role === 'user')!;
  const largePayload = JSON.parse(largeUser.content) as Json;
  (largePayload.applicationDecision as Json).futureLargeIdentityAnswer = 'あ'.repeat(30_000);
  largeUser.content = JSON.stringify(largePayload);
  largeContext.requestBytes = new TextEncoder().encode(JSON.stringify(largeMessages)).byteLength;
  inputs.push(extended, large);

  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) {
      if (fail) { fail = false; throw new Error('first material trace write failed'); }
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
    const rateEntry = set.find((entry) => (entry as unknown as Json).requestId === rate.requestId)! as unknown as {
      aiInterpreter: { rawResponses: Array<{ text: string }>; structuredResults: Array<{ accepted: boolean; structuredResult: Json }> };
    };
    const providerDecision = JSON.parse(rateEntry.aiInterpreter.rawResponses[0].text) as Json;
    expect(providerDecision).toMatchObject({ decision: 'effort_answer', workloadChoice: 'w1', minutes: 3, sourceText: MATERIAL_RATE_TEXT });
    const accepted = rateEntry.aiInterpreter.structuredResults.find((result) => result.accepted)!.structuredResult;
    const acceptedTask = (accepted.tasks as Json[])[0];
    expect((acceptedTask.effortEstimates as Json[])[0]).toMatchObject({ targetLocalId: 'focused_material_task', minutes: 3 });
    expect(acceptedTask.workloads).toEqual([]);
    expect((acceptedTask.study as Json).components).toEqual([]);
    expect(byRequest(rate.requestId!)).toContain('material_identity');
    expect(byRequest(rate.requestId!)).toContain('"minutes":3');
    expect(byRequest(answer.requestId!)).toContain('青チャート');
    expect(byRequest(answer.requestId!)).toContain('superseded');
    if (answerText === MATERIAL_MIXED) {
      const answerEntry = set.find((entry) => (entry as unknown as Json).requestId === answer.requestId)! as unknown as {
        aiInterpreter: { rawResponses: Array<{ text: string }> };
      };
      expect(JSON.parse(answerEntry.aiInterpreter.rawResponses[0].text)).toMatchObject({
        decision: 'material_and_effort_answer', label: '青チャート', minutes: 3,
        sourceText: '青チャート', effortSourceText: '1問3分くらい',
      });
    }
    expect(byRequest(extended.requestId)).toContain(SENTINEL);
    expect(byRequest(large.requestId)).toMatch(/traceProjectionTruncated|traceTruncatedItems|truncated/u);
    expect(byRequest(large.requestId)).not.toContain('あ'.repeat(30_000));
  }
});
