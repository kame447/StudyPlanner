import { recordCommittedWeeklyPlanningApplicationTurn } from './weeklyPlanningTurnTraceSideEffects';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { finalizeWeeklyPlanningStableV5RuntimeGraph, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
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
function fixture(cap = 20, planningIntent: 'create_plan' | 'discuss' = 'create_plan', preferred = false, onlyDaytime = false) {
  const userText = `8月24日に数学の教材を1問進めたい。1問35分、1回${cap}分で予定を作って。${preferred ? "18時から22時を希望。" : ""}${onlyDaytime ? "9時から10時だけ空いています。" : ""}`;
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent,
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-24', start: '2026-08-24', end: '2026-08-24', sourceText: '8月24日' },
    tasks: [{ localId: 'task', category: 'study', title: '数学の教材', study: { purpose: 'self_study', contextLabel: null, components: [] }, sourceText: '数学の教材',
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 1, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '1問進めたい' }],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 35, unitCode: 'problem', precision: 'exact', sourceText: '1問35分' },
        { localId: 'cap', targetLocalId: 'task', kind: 'session_duration', minutes: cap, unitCode: 'session', precision: 'exact', sourceText: `1回${cap}分` }], temporalConstraints: preferred ? [{ localId: 'night', targetLocalId: 'task', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: null, startTime: '18:00', endTime: '22:00', precision: 'exact', sourceText: '18時から22時を希望' }] : [], recurrence: [] }],
    relations: [], availabilityDeclarations: onlyDaytime ? [{ localId: 'available', kind: 'available', dateExpression: null, namedTimePeriod: null, startTime: '09:00', endTime: '10:00', recurrenceKind: null, days: [], constraintLevel: 'hard', sourceText: '9時から10時だけ空いています' }] : [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  };
  const input = { userText, messages: [], selectedDate: '2026-08-24', userId: USER, plans: [], studyMaterials: [], scheduleTemplates: [], conversationId: CONVERSATION, traceRequestId: 'session-disclosure-turn',
    requestContext: { startedAtIso: '2026-08-24T00:00:00.000Z', timeZone: 'UTC', currentDate: '2026-08-24', currentTime: '00:00', notBeforeDate: '2026-08-24', notBeforeTime: '00:00', weekStartsOn: 'monday' as const } };
  return { document, input };
}
async function execute(cap = 20, intent: 'create_plan' | 'discuss' = 'create_plan', preferred = false, onlyDaytime = false) {
  return executeFixture(fixture(cap, intent, preferred, onlyDaytime));
}
async function executeFixture({ document, input }: ReturnType<typeof fixture>) {
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
  it.each(['satisfied', 'not_satisfied', 'not_evaluated'] as const)('keeps state and normal fallback semantics for %s', async status => {
    const run = await execute(status === 'satisfied' ? 60 : 20);
    if (status === 'not_evaluated') run.result.previewConstraintSatisfaction![0].status = status;
    const before = structuredClone(run.result); completion.mockRejectedValue(new Error('injected renderer failure'));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('deterministic_fallback');
    expect(rendered.message).toBe(status === 'satisfied' ? before.message : '返信を作れませんでした。少し待ってからもう一度送信してください。');
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
  it('passes the actual preferred result and interprets both evidence kinds in the provider request', async () => {
    const run = await execute(20, 'create_plan', true);
    const before = structuredClone(run.result);
    expect(run.result.previewConstraintSatisfaction).toMatchObject([
      { kind: 'preferred_window', status: 'satisfied' }, { kind: 'session_duration', status: 'not_satisfied' },
    ]);
    expect(run.result.draftCandidates[0].startTime).toBe('18:00');
    const text = `数学の教材の候補を用意しました。「${CONTROL}」から確認できます。`;
    completion.mockImplementation(async request => response(request, text));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('ai'); expect(rendered.message).toBe(text);
    const prompt = JSON.parse(completion.mock.calls[0][0].messages[1].content);
    expect(prompt.applicationDecision.previewConstraintSatisfaction).toEqual(before.previewConstraintSatisfaction);
    expect(prompt.request).toContain('preferred_window'); expect(prompt.request).toContain('session_duration');
    expect(prompt.request).toContain('選択肢');
    expect(rendered.draftCandidates).toEqual(before.draftCandidates); expect(rendered.state).toEqual(before.state);
    expect(rendered.stableV5Graph).toEqual(before.stableV5Graph); expect(completion).toHaveBeenCalledTimes(1);
  });

  it('does not project preferred success into an ordinary non-preview reply', async () => {
    const run = await execute(60, 'discuss', true);
    expect(run.result.draftCandidates).toEqual([]); expect(run.result.previewConstraintSatisfaction).toBeUndefined();
    completion.mockRejectedValue(new Error('injected renderer failure'));
    await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision).not.toHaveProperty('previewConstraintSatisfaction');
  });

  it('uses the existing technical fallback when only the preferred window is unmet', async () => {
    const run = await execute(60, 'create_plan', true, true);
    expect(run.result.previewConstraintSatisfaction).toMatchObject([
      { kind: 'preferred_window', status: 'not_satisfied' }, { kind: 'session_duration', status: 'satisfied' },
    ]);
    expect(run.result.draftCandidates[0].startTime).toBe('09:00');
    const before = structuredClone(run.result);
    completion.mockRejectedValue(new Error('injected renderer failure'));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('deterministic_fallback');
    expect(rendered.message).toBe('返信を作れませんでした。少し待ってからもう一度送信してください。');
    expect(rendered.draftCandidates).toEqual(before.draftCandidates); expect(rendered.state).toEqual(before.state);
    expect(rendered.stableV5Graph).toEqual(before.stableV5Graph); expect(completion).toHaveBeenCalledTimes(1);
  });

  it('does not reacquire preferred success when an existing preview is retained', async () => {
    const first = await execute(60, 'create_plan', true);
    finalizeWeeklyPlanningStableV5RuntimeGraph({ ownerId: USER, conversationId: CONVERSATION, requestId: first.input.traceRequestId });
    const userText = '候補はそのままにしてください';
    const document: WeeklyPlanningSemanticDocumentV5 = {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'update_plan', planningWindow: null,
      tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [],
      decisions: [],
    };
    const validated = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: userText });
    expect(validated.errors).toEqual([]);
    const previousResponse = await normalize.mock.results[0].value;
    normalize.mockResolvedValue({ ...previousResponse, document: validated.document });
    const input = { ...first.input, previousState: first.result.state, userText, traceRequestId: 'retained-preview-turn', retainedPreviewCount: first.result.draftCandidates.length };
    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input);
    expect(result.preserveExistingPreview).toBe(true); expect(result.draftCandidates).toEqual([]);
    expect(result.previewConstraintSatisfaction).toBeUndefined();
    completion.mockRejectedValue(new Error('injected renderer failure'));
    await renderWeeklyPlanningStableV5AssistantMessage({ input, result });
    if (completion.mock.calls.length > 0) expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision).not.toHaveProperty('previewConstraintSatisfaction');
  });

  it('passes a joint task result without asserting each component preference was individually missed', async () => {
    const prepared = fixture(60, 'create_plan', false, true);
    prepared.input.userText = '8月24日に数学の教材Aを60分、教材Bを60分、1回60分で予定を作って。教材Aは9時から10時、教材Bは18時から19時を希望。9時から12時だけ空いています。';
    const task = prepared.document.tasks[0];
    task.title = '数学'; task.sourceText = '数学'; task.workloads = [];
    task.study!.components = ['A', 'B'].map(label => ({ localId: `component-${label}`, parentLocalId: null,
      role: 'material', label: `教材${label}`, sourceText: `教材${label}`,
      workloads: [{ localId: `work-${label}`, quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: `教材${label}を60分` }],
    }));
    task.effortEstimates = task.effortEstimates.filter(fact => fact.kind === 'session_duration');
    task.temporalConstraints = [
      { localId: 'window-A', targetLocalId: 'component-A', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null,
        namedTimePeriod: null, startTime: '09:00', endTime: '10:00', precision: 'exact', sourceText: '教材Aは9時から10時' },
      { localId: 'window-B', targetLocalId: 'component-B', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null,
        namedTimePeriod: null, startTime: '18:00', endTime: '19:00', precision: 'exact', sourceText: '教材Bは18時から19時を希望' },
    ];
    prepared.document.availabilityDeclarations[0].endTime = '12:00';
    prepared.document.availabilityDeclarations[0].sourceText = '9時から12時だけ空いています';
    const run = await executeFixture(prepared);
    const graph = run.result.stableV5Graph!;
    const componentA = graph.components.find(component => component.label === '教材A')!;
    const componentB = graph.components.find(component => component.label === '教材B')!;
    const candidates = run.result.draftCandidates as Array<typeof run.result.draftCandidates[number] & { stableV5Metadata: { sourceFactRefs: string[] } }>;
    expect(candidates.find(candidate => candidate.stableV5Metadata.sourceFactRefs.includes(componentA.id))).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    expect(candidates.find(candidate => candidate.stableV5Metadata.sourceFactRefs.includes(componentB.id))?.startTime).not.toBe('18:00');
    const evidence = run.result.previewConstraintSatisfaction!.filter(entry => entry.kind === 'preferred_window');
    expect(evidence).toHaveLength(2); expect(evidence.map(entry => entry.status)).toEqual(['not_satisfied', 'not_satisfied']);
    const text = `数学の希望時間帯は候補全体では満たせていません。「${CONTROL}」から確認できます。`;
    completion.mockImplementation(async request => response(request, text));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('ai'); expect(rendered.message).toBe(text); expect(completion).toHaveBeenCalledTimes(1);
    const prompt = JSON.parse(completion.mock.calls[0][0].messages[1].content);
    expect(prompt.applicationDecision.previewConstraintSatisfaction.filter((entry: { kind: string }) => entry.kind === 'preferred_window')).toEqual(evidence);
    expect(prompt.request).toContain('同じtaskIdの適用条件群と候補全体の共同結果');
    expect(prompt.request).toContain('各sourceFactIdの条件が個別に未達とは断定しない');
  });

  it.each([false, true])('persists the actual new diagnostic/provider request through reset retry and Worker (large=%s)', async large => {
    const run = await execute(20, 'create_plan', true);
    const remembered = vi.spyOn(rendererTraceOwner, 'rememberWeeklyPlanningDialogueRendererPromptContext');
    completion.mockImplementation(async request => response(request, `数学の教材は、希望の区切りを候補全体では満たせていません。「${CONTROL}」から確認できます。`));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('ai');
    expect(run.result.previewConstraintSatisfaction?.map(entry => entry.kind)).toEqual(['preferred_window', 'session_duration']);
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
    expect(storedPromptJson).toContain('preferred_window');
    expect(storedPromptJson).toContain('session_duration');
    for (const evidence of run.result.previewConstraintSatisfaction!) expect(storedPromptJson).toContain(evidence.sourceFactId);
    if (large) expect(storedPromptJson).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(first.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: first.session as unknown as Record<string, unknown>, entries: first.entries as unknown as Record<string, unknown>[] },
      { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, { sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-08-24T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1); expect(JSON.stringify(prepared.entries[0])).toContain('futureSessionCapSentinel');
    expect(persistedPromptContext(prepared.entries[0])).toEqual(storedPrompt);
    for (const evidence of run.result.previewConstraintSatisfaction!) expect(JSON.stringify(prepared.entries[0])).toContain(evidence.sourceFactId);
    if (large) expect(JSON.stringify(prepared.entries[0])).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});
