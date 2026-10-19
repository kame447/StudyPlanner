import { recordCommittedWeeklyPlanningApplicationTurn } from './weeklyPlanningTurnTraceSideEffects';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { renderWeeklyPlanningStableV5AssistantMessage } from '../dialogue/weeklyPlanningStableV5TurnDialogue';
import * as rendererTraceOwner from '../trace/weeklyPlanningDialogueRendererTrace';
import { resetWeeklyPlanningDialogueRendererPromptContextsForTest } from '../trace/weeklyPlanningDialogueRendererTrace';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

const { normalize, completion } = vi.hoisted(() => ({ normalize: vi.fn(), completion: vi.fn<OpenAiCompatibleClient['createChatCompletion']>() }));
vi.mock('../../../lib/aiConfig', () => ({ getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test', apiKey: 'test' }), getAiConfigValidationMessage: () => undefined }));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({ createOpenAiCompatibleClient: () => ({ createChatCompletion: completion }) }));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({ createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize }) }));
const USER = 'owner-session-disclosure';
const CONVERSATION = 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000';
const CONTROL = 'この内容で仮予定にする';
function fixture(cap = 20, planningIntent: 'create_plan' | 'discuss' = 'create_plan') {
  const userText = `8月24日に数学の教材を1問進めたい。1問35分、1回${cap}分で予定を作って。`;
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent,
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-24', start: '2026-08-24', end: '2026-08-24', sourceText: '8月24日' },
    tasks: [{ localId: 'task', category: 'study', title: '数学の教材', study: { purpose: 'self_study', contextLabel: null, components: [] }, sourceText: '数学の教材',
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 1, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '1問進めたい' }],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 35, unitCode: 'problem', precision: 'exact', sourceText: '1問35分' },
        { localId: 'cap', targetLocalId: 'task', kind: 'session_duration', minutes: cap, unitCode: 'session', precision: 'exact', sourceText: `1回${cap}分` }], temporalConstraints: [], recurrence: [] }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  };
  const input = { userText, messages: [], selectedDate: '2026-08-24', userId: USER, plans: [], studyMaterials: [], scheduleTemplates: [], conversationId: CONVERSATION, traceRequestId: 'session-disclosure-turn',
    requestContext: { startedAtIso: '2026-08-24T00:00:00.000Z', timeZone: 'UTC', currentDate: '2026-08-24', currentTime: '00:00', notBeforeDate: '2026-08-24', notBeforeTime: '00:00', weekStartsOn: 'monday' as const } };
  return { document, input };
}
async function execute(cap = 20, intent: 'create_plan' | 'discuss' = 'create_plan') {
  const { document, input } = fixture(cap, intent);
  const validated = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: input.userText });
  expect(validated.errors).toEqual([]); expect(validated.document).not.toBeNull();
  normalize.mockResolvedValue({ status: 'accepted', document: validated.document, diagnostics: {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, jsonSchemaName: 'weekly_planning_semantic_document_v5', normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
    requestBytes: [100], responseLengths: [100], latencyMs: 1, validationErrors: [], algorithmicRepairs: [], providerError: null,
  } });
  return { input, result: await executeWeeklyPlanningStableV5RuntimeTurn(input) };
}
function response(request: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0], text: string) {
  const prompt = JSON.parse(request.messages[1].content);
  return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind, questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text });
}
function persistedPromptContext(entry: unknown): unknown {
  const diagnostics = (entry as { diagnostics: Record<string, unknown> }).diagnostics;
  const renderer = diagnostics.dialogueRenderer as Record<string, unknown>;
  return (renderer.request as Record<string, unknown>).promptContext;
}
let restore: (() => void) | undefined;
let storage: ReturnType<typeof createMemoryStorageHarness>;
beforeEach(() => {
  storage = createMemoryStorageHarness();
  restore = installWeeklyPlanningTestStorage(storage.storage);
  normalize.mockReset(); completion.mockReset(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
});
afterEach(() => { resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningDialogueRendererPromptContextsForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); restore?.(); vi.restoreAllMocks(); });

describe('session cap actual runtime to current renderer disclosure', () => {
  it('passes only actual scoped preview evidence without changing candidates or approval state', async () => {
    const run = await execute(); const before = structuredClone(run.result);
    const cap = run.result.stableV5Graph!.effortEstimates.find(fact => fact.kind === 'session_duration')!;
    expect(run.result.previewConstraintSatisfaction).toEqual([{ sourceFactId: cap.id, taskId: cap.taskId, taskLabel: '数学の教材', kind: 'session_duration', status: 'not_satisfied' }]);
    expect(run.result.draftCandidates.map(candidate => candidate.durationMinutes)).toEqual([40]);
    const text = `数学の教材は、希望の区切りを候補全体では満たせていません。「${CONTROL}」から確認できます。`;
    completion.mockImplementation(async request => response(request, text));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('ai'); expect(rendered.message).toBe(text);
    const prompt = JSON.parse(completion.mock.calls[0][0].messages[1].content);
    expect(prompt.applicationDecision.previewConstraintSatisfaction).toEqual(before.previewConstraintSatisfaction);
    expect(prompt.request).toContain('超過・欠落などの原因や変更を推測しない');
    expect(rendered.draftCandidates).toEqual(before.draftCandidates); expect(rendered.state).toEqual(before.state); expect(rendered.stableV5Graph).toEqual(before.stableV5Graph);
    expect(completion).toHaveBeenCalledTimes(1);
  });
  it.each(['satisfied', 'not_satisfied', 'not_evaluated'] as const)('keeps actual preview state without falsely claiming success on renderer outage: %s', async status => {
    const run = await execute(status === 'satisfied' ? 60 : 20);
    if (status === 'not_evaluated') run.result.previewConstraintSatisfaction![0].status = status;
    const before = structuredClone(run.result); completion.mockRejectedValue(new Error('injected renderer failure'));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('deterministic_fallback');
    expect(rendered.message).toBe('返信を作れませんでした。少し待ってからもう一度送信してください。');
    expect(rendered.message).not.toBe(before.message);
    expect(rendered.questionPresentationContent).toBeUndefined();
    expect(rendered.dialogueRendererTrace?.response).toMatchObject({ status: 'fallback', reason: 'provider_error' });
    expect(rendered.draftCandidates).toEqual(before.draftCandidates); expect(rendered.state).toEqual(before.state); expect(rendered.stableV5Graph).toEqual(before.stableV5Graph);
    expect(completion).toHaveBeenCalledTimes(1);
  });
  it('does not project a cap into a non-preview reply', async () => {
    const run = await execute(20, 'discuss');
    expect(run.result.draftCandidates).toEqual([]); expect(run.result.previewConstraintSatisfaction).toBeUndefined();
    completion.mockRejectedValue(new Error('injected renderer failure'));
    await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision).not.toHaveProperty('previewConstraintSatisfaction');
  });
  it.each([false, true])('persists the actual new diagnostic/provider request through reset retry and Worker (large=%s)', async large => {
    const run = await execute();
    const remembered = vi.spyOn(rendererTraceOwner, 'rememberWeeklyPlanningDialogueRendererPromptContext');
    completion.mockImplementation(async request => response(request, `数学の教材は、希望の区切りを候補全体では満たせていません。「${CONTROL}」から確認できます。`));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('ai');
    const trace = structuredClone(rendered.dialogueRendererTrace!);
    const context = remembered.mock.calls.find(([actionId]) => actionId === trace.actionId)?.[1] as Record<string, unknown>;
    expect(context).toBeDefined();
    expect(context.messages).toEqual(completion.mock.calls[0][0].messages);
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision.previewConstraintSatisfaction).toEqual(run.result.previewConstraintSatisfaction);
    trace.request!.promptContext = { futureSessionCapSentinel: { preserved: true }, ...context, ...(large ? { largeFutureSessionCap: 'session-cap-data'.repeat(30_000) } : {}) };
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let fail = true;
    const repository: WeeklyPlanningTraceRepository = { async upsertSession() {}, async appendEntries(params) { if (fail) { fail = false; throw new Error('append failure'); } writes.push(structuredClone(params)); },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; } };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const record = { userId: USER, conversationId: CONVERSATION, requestId: run.input.traceRequestId, userText: run.input.userText, assistantMessage: rendered.message, responseSource: 'ai' as const,
      outcome: 'draft_ready', previewCount: rendered.draftCandidates.length, debugTraceEvents: [], dialogueRendererTrace: trace };
    // Enter through the same transport-bounding owner used after a real commit.
    await recordCommittedWeeklyPlanningApplicationTurn({ ownerId: USER,
      pending: { requestId: run.input.traceRequestId, conversationId: CONVERSATION, turnId: 'turn', weekStartDate: '2026-08-24', baseRevision: 0, startedAt: '2026-08-24T00:00:00.000Z' },
      userText: run.input.userText, result: { ...rendered, dialogueRendererTrace: trace },
    });
    expect(writes).toHaveLength(0);
    const pending = listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION });
    expect(pending).toHaveLength(1);
    expect(pending[0].input).toMatchObject({ requestId: run.input.traceRequestId, userText: run.input.userText, assistantMessage: rendered.message, previewCount: rendered.draftCandidates.length });
    const boundedContext = pending[0].input.dialogueRendererTrace!.request!.promptContext as Record<string, unknown>;
    if (large) {
      const original = JSON.stringify(trace.request!.promptContext);
      expect(boundedContext).toMatchObject({ traceTruncated: true, originalBytes: new TextEncoder().encode(original).byteLength,
        jsonHead: expect.any(String), jsonTail: expect.any(String) });
      expect(original.startsWith(boundedContext.jsonHead as string)).toBe(true);
      expect(original.endsWith(boundedContext.jsonTail as string)).toBe(true);
    }
    const persistedOutbox = JSON.parse(storage.storage.getItem('studyplanner.weeklyPlanning.trace.outbox.v1')!);
    expect(persistedOutbox.items).toEqual(pending);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual(persistedOutbox.items);
    await recordWeeklyPlanningStableV5TurnTrace({ ...record, requestId: 'session-retry', dialogueRendererTrace: undefined });
    expect(writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);
    const first = writes[0]; const serialized = JSON.stringify(first.entries[0]);
    expect(serialized).toContain('futureSessionCapSentinel');
    expect(first.entries[0].kind).toBe('turn_diagnostic');
    if (first.entries[0].kind !== 'turn_diagnostic') throw new Error('missing persisted diagnostic');
    const storedPrompt = persistedPromptContext(first.entries[0]);
    const storedPromptJson = JSON.stringify(storedPrompt);
    expect(storedPromptJson).toContain('futureSessionCapSentinel');
    expect(storedPromptJson).toContain('previewConstraintSatisfaction');
    expect(storedPromptJson).toContain('not_satisfied');
    expect(storedPromptJson).toContain(run.result.previewConstraintSatisfaction![0].sourceFactId);
    if (large) expect(storedPromptJson).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(first.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: first.session as unknown as Record<string, unknown>, entries: first.entries as unknown as Record<string, unknown>[] },
      { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, { sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-08-24T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1); expect(JSON.stringify(prepared.entries[0])).toContain('futureSessionCapSentinel');
    expect(persistedPromptContext(prepared.entries[0])).toEqual(storedPrompt);
    if (large) expect(JSON.stringify(prepared.entries[0])).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});
