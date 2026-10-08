import { afterEach, expect, it } from 'vitest';
import { emptyMaterialAnswer, FOCUSED_MATERIAL_SCHEMA } from '../testUtils/weeklyPlanningFocusedMaterialAnswerFixture';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedConversationTurn,
} from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import {
  recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';

type Json = Record<string, unknown>;
const OWNER = 'required-clarification-trace-owner';
const CONVERSATION = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174000';
const SETUP = '来週、数学の問題集を20問進めたい';
const RATE = '1問3分くらい';
const MATERIAL = '青チャートです';
const SENTINEL = 'future-required-clarification-field';

function document(overrides: Json = {}): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...overrides,
  };
}

function task(existingPublicId: string | null, sourceText: string): Json {
  return {
    localId: 't', existingPublicId, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText,
  };
}

function workload(sourceText: string): Json {
  return { localId: 'wl', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText };
}

function traceInput(turn: ScriptedConversationTurn) {
  return {
    userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: 'turn',
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!),
    outcome: turn.result!.draftCandidates.length ? 'preview' : 'question',
    debugTraceEvents: turn.debugTrace, previewCount: turn.result!.draftCandidates.length,
  };
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
let restoreStorage: (() => void) | undefined;

afterEach(() => {
  provider?.restore();
  restoreStorage?.();
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
});

it('retains the required question and accepted rate through real turn traces, outbox retry and Worker preparation', async () => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'どの教材を使いますか？');
    if (call.schemaName === FOCUSED_MATERIAL_SCHEMA) {
      const text = String(call.payload?.currentUserText ?? '');
      return JSON.stringify(text === RATE ? emptyMaterialAnswer('effort_answer', { workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: RATE })
        : text === MATERIAL ? emptyMaterialAnswer('material_answer', { label: '青チャート', sourceText: '青チャート' }) : emptyMaterialAnswer('explain_question', { sourceText: text }));
    }
    const text = String(call.payload?.userText ?? '');
    if (text === SETUP) return JSON.stringify(document({
      planningIntent: 'create_plan',
      planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
      tasks: [{ ...task(null, '数学の問題集を20問進めたい'), workloads: [workload('数学の問題集を20問')] }],
      uncertainties: [{ localId: 'u', targetLocalId: 't', field: 'material', reason: '教材が未確定', sourceText: '数学の問題集' }],
    }));
    const publicState = (call.payload?.publicStateSummary ?? {}) as Json;
    const taskId = ((publicState.tasks ?? []) as Json[])[0]?.publicId as string;
    if (text === RATE) return JSON.stringify(document({
      planningIntent: 'update_plan', tasks: [{ ...task(taskId, RATE), workloads: [workload(RATE)],
        effortEstimates: [{ localId: 'e', targetLocalId: 'wl', kind: 'duration_per_unit', minutes: 3,
          unitCode: 'problem', precision: 'approximate', sourceText: RATE }],
      }],
      conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }],
    }));
    if (text === MATERIAL) return JSON.stringify(document({
      planningIntent: 'update_plan', tasks: [{ ...task(taskId, MATERIAL), decompositionStatus: 'decomposed',
        study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [{
          localId: 'material', existingPublicId: null, parentLocalId: null, role: 'material', label: '青チャート',
          workloads: [], durableContextSignals: [], sourceText: '青チャート',
        }] },
      }],
    }));
    return JSON.stringify(document({ conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }] }));
  });
  const conversation = createScriptedConversation({ provider, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1' });
  const setup = await conversation.submit(SETUP);
  const explanation = await conversation.submit('なんで時間が必要なの？');
  const rate = await conversation.submit(RATE);
  expect(rate.result?.draftCandidates).toHaveLength(0);
  const renderer = rate.calls.find((call) => call.kind === 'renderer')!;
  const material = await conversation.submit(MATERIAL);
  expect(material.result!.draftCandidates.length).toBeGreaterThan(0);
  const inputs = [setup, explanation, rate, material].map(traceInput);
  // The recorded prompt is the request actually sent, before any extension.
  const context = inputs[2].dialogueRendererTrace.request!.promptContext as Json;
  expect(context.messages).toEqual(renderer.messages);
  expect(JSON.stringify(renderer.payload)).toContain('semantic_uncertainty');

  const extended = structuredClone(inputs[2]);
  extended.requestId = `${CONVERSATION}:request:future`;
  const extendedContext = extended.dialogueRendererTrace.request!.promptContext as Json;
  const messages = extendedContext.messages as Array<{ role: string; content: string }>;
  const user = messages.find((message) => message.role === 'user')!;
  const payload = JSON.parse(user.content) as Json;
  (payload.applicationDecision as Json).futureRequiredQuestion = SENTINEL;
  user.content = JSON.stringify(payload);
  extendedContext.requestBytes = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
  const large = structuredClone(extended);
  large.requestId = `${CONVERSATION}:request:oversized`;
  const largeContext = large.dialogueRendererTrace.request!.promptContext as Json;
  const largeMessages = largeContext.messages as Array<{ role: string; content: string }>;
  const largeUser = largeMessages.find((message) => message.role === 'user')!;
  const largePayload = JSON.parse(largeUser.content) as Json;
  (largePayload.applicationDecision as Json).futureLargeQuestion = 'あ'.repeat(30_000);
  largeUser.content = JSON.stringify(largePayload);
  largeContext.requestBytes = new TextEncoder().encode(JSON.stringify(largeMessages)).byteLength;
  inputs.push(extended, large);

  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let firstWrite = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) {
      if (firstWrite) { firstWrite = false; throw new Error('injected first append failure'); }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {},
    async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(inputs[0]);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  for (const input of inputs.slice(1)) await recordWeeklyPlanningStableV5TurnTrace(input);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
  expect(writes.flatMap((write) => write.entries)).toHaveLength(inputs.length);

  const entries = writes.flatMap((write) => write.entries);
  const preparedEntries = writes.flatMap((write) => prepareWeeklyPlanningTraceServerWrite({
    session: write.session as unknown as Json, entries: write.entries as unknown as Json[],
  }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, {
    sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174000', logicalConversationId: CONVERSATION,
  }, '2026-10-07T00:00:00.000Z').entries);
  for (const entry of entries) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  for (const entry of preparedEntries) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  for (const set of [entries, preparedEntries]) {
    const byRequest = (id: string) => JSON.stringify(set.find((entry) => (entry as unknown as Json).requestId === id));
    expect(byRequest(explanation.requestId!)).toContain('explain_question');
    for (const marker of ['"field":"material"', 'duration_per_unit', 'semantic_uncertainty', 'ask_question', '"minutes":3']) {
      expect(byRequest(rate.requestId!)).toContain(marker);
    }
    expect(byRequest(extended.requestId)).toContain(SENTINEL);
    expect(byRequest(large.requestId)).toMatch(/traceProjectionTruncated|traceTruncatedItems|truncated/u);
    expect(byRequest(large.requestId)).not.toContain('あ'.repeat(30_000));
  }
});
