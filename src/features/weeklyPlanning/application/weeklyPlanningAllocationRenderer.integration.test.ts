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
const USER = 'owner-allocation-renderer';
const CONVERSATION = 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000';
const CONTROL = 'この内容で仮予定にする';
import * as previewOwner from './weeklyPlanningStableV5PreviewExecution';
import { summarizeWeeklyPlanningAllocationBreakdown, type WeeklyPlanningAllocationBreakdown } from '../semantic/weeklyPlanningAllocationBreakdown';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import { WeeklyPlanningAllocationSummary } from '../../../components/WeeklyPlanningAllocationSummary';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';

// This keeps the test-only baseline type-correct before the optional evidence field exists.
function allocation(result: WeeklyPlanningTurnExecutionResult): WeeklyPlanningAllocationBreakdown | undefined {
  return (result as WeeklyPlanningTurnExecutionResult & { allocationBreakdown?: WeeklyPlanningAllocationBreakdown }).allocationBreakdown;
}
function fixture(unit: 'page' | 'minute' = 'page', planningIntent: 'create_plan' | 'discuss' = 'create_plan') {
  const userText = unit === 'page' ? '8月24日に数学の教材を20ページ進めたい。1ページ3分で予定を作って。' : '8月24日に数学の教材を60分進める予定を作って。';
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent,
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-24', start: '2026-08-24', end: '2026-08-24', sourceText: '8月24日' },
    tasks: [{ localId: 'task', category: 'study', title: '数学の教材', study: { purpose: 'self_study', contextLabel: null, components: [] }, sourceText: '数学の教材',
      workloads: [{ localId: 'work', quantityRole: 'target', amount: unit === 'page' ? 20 : 60, unitCode: unit, unitLabel: unit === 'page' ? 'ページ' : '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: unit === 'page' ? '20ページ進めたい' : '60分進める' }],
      effortEstimates: unit === 'page' ? [{ localId: 'rate', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'exact', sourceText: '1ページ3分' }] : [], temporalConstraints: [], recurrence: [] }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  };
  const input = { userText, messages: [], selectedDate: '2026-08-24', userId: USER, plans: [], studyMaterials: [], scheduleTemplates: [], conversationId: CONVERSATION, traceRequestId: 'allocation-renderer-turn',
    requestContext: { startedAtIso: '2026-08-24T00:00:00.000Z', timeZone: 'UTC', currentDate: '2026-08-24', currentTime: '00:00', notBeforeDate: '2026-08-24', notBeforeTime: '00:00', weekStartsOn: 'monday' as const } };
  return { document, input };
}
function accept(document: WeeklyPlanningSemanticDocumentV5, userText: string) {
  const validated = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: userText });
  expect(validated.errors).toEqual([]); expect(validated.document).not.toBeNull();
  normalize.mockResolvedValue({ status: 'accepted', document: validated.document, diagnostics: {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, jsonSchemaName: 'weekly_planning_semantic_document_v5', normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
    requestBytes: [100], responseLengths: [100], latencyMs: 1, validationErrors: [], algorithmicRepairs: [], providerError: null,
  } });
}
async function execute(unit: 'page' | 'minute' = 'page', intent: 'create_plan' | 'discuss' = 'create_plan') {
  const { document, input } = fixture(unit, intent);
  accept(document, input.userText);
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

describe('allocation evidence from the new preview to the current renderer', () => {
  it('passes two real session candidates as blocks in one preview without creating alternatives or save authority', async () => {
    const prepared = fixture('minute');
    prepared.input.userText = '8月24日に数学の教材を60分、1回30分で予定を作って。';
    prepared.document.tasks[0].effortEstimates = [{ localId: 'cap', targetLocalId: 'task', kind: 'session_duration',
      minutes: 30, unitCode: 'session', precision: 'exact', sourceText: '1回30分' }];
    accept(prepared.document, prepared.input.userText);
    const run = { input: prepared.input, result: await executeWeeklyPlanningStableV5RuntimeTurn(prepared.input) };
    const before = structuredClone(run.result);
    expect(before.draftCandidates.map(candidate => candidate.durationMinutes)).toEqual([30, 30]);
    expect(new Set(before.draftCandidates.map(candidate => candidate.stableKey)).size).toBe(2);
    expect(before.state.shouldSavePlan).toBe(false);
    const text = `数学の教材の候補2件を作成しました。「${CONTROL}」から確認できます。`;
    completion.mockImplementation(async request => response(request, text));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    const prompt = JSON.parse(completion.mock.calls[0][0].messages[1].content);
    expect(prompt.applicationDecision.previewCount).toBe(2);
    expect(prompt.request).toContain('previewCount counts blocks in ONE preview');
    expect(prompt.request).toContain('候補N件, never N個/つのプレビュー or N案');
    expect(prompt.applicationDecision.previewPromotionControlLabel).toBe(CONTROL);
    expect(rendered.responseSource).toBe('ai'); expect(rendered.message).toBe(text);
    expect(rendered.draftCandidates).toEqual(before.draftCandidates);
    expect(rendered.state).toEqual(before.state); expect(rendered.stableV5Graph).toEqual(before.stableV5Graph);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it.each(['page', 'minute'] as const)('matches the actual %s candidate and UI summary without changing approval or state', async unit => {
    const run = await execute(unit); const before = structuredClone(run.result);
    const expected = summarizeWeeklyPlanningAllocationBreakdown(before.draftCandidates);
    expect(expected).toMatchObject({ estimatedMinutes: 60, allocatedMinutes: unit === 'page' ? 70 : 60, marginMinutes: unit === 'page' ? 10 : 0 });
    expect(allocation(run.result)).toEqual(expected);
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: before.draftCandidates, userId: USER, createdAt: '2026-08-24T00:00:00.000Z' });
    const summary = WeeklyPlanningAllocationSummary({ blocks });
    if (unit === 'page') expect(summary?.props.children.join('')).toBe('見積もり1時間＋余裕10分');
    else expect(summary).toBeNull();
    const text = `数学の教材の候補を作成しました。「${CONTROL}」から確認できます。`;
    completion.mockImplementation(async request => response(request, text));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('ai'); expect(rendered.message).toBe(text);
    const prompt = JSON.parse(completion.mock.calls[0][0].messages[1].content);
    expect(prompt.applicationDecision.allocationBreakdown).toEqual(expected);
    expect(prompt.request).toContain('見積もり・余裕の内訳はUI表示に任せ');
    expect(prompt.request).toContain('allocatedMinutesをユーザーの指定量');
    expect(prompt.request).toContain('明示した具体値がある場合');
    expect(prompt.applicationDecision.previewPromotionControlLabel).toBe(CONTROL);
    expect(rendered.draftCandidates).toEqual(before.draftCandidates); expect(rendered.state).toEqual(before.state); expect(rendered.stableV5Graph).toEqual(before.stableV5Graph);
    expect(JSON.stringify(rendered.state)).not.toContain('allocationBreakdown');
    expect(JSON.stringify(rendered.stableV5Graph)).not.toContain('allocationBreakdown');
    expect(completion).toHaveBeenCalledTimes(1);
  });
  // Supply already allocated stages at the preview boundary. This verifies transport,
  // not adoption of the independent session/cap or personalization implementation.
  it.each([
    { estimatedMinutes: 60, calibratedMinutes: 60, bufferedMinutes: 66, allocatedMinutes: 60, marginMinutes: 0, reasons: ['estimate_margin'] },
    { estimatedMinutes: 50, calibratedMinutes: 55, bufferedMinutes: 60.5, allocatedMinutes: 60, marginMinutes: 10, reasons: ['calibration', 'estimate_margin'] },
  ] satisfies WeeklyPlanningAllocationBreakdown[])('preserves distinct stages, including buffered above actual (%j)', async expected => {
    const actual = previewOwner.executeWeeklyPlanningStableV5Preview;
    vi.spyOn(previewOwner, 'executeWeeklyPlanningStableV5Preview').mockImplementation(params => {
      const preview = actual(params);
      return { ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate, allocationBreakdown: expected })) };
    });
    const run = await execute('minute'); expect(allocation(run.result)).toEqual(expected);
    completion.mockImplementation(async request => response(request, `候補を作成しました。「${CONTROL}」から確認できます。`));
    await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision.allocationBreakdown).toEqual(expected);
  });
  it.each(['missing', 'stale', 'mixed'] as const)('withholds the whole-preview field and instruction for %s metadata', async mode => {
    const actual = previewOwner.executeWeeklyPlanningStableV5Preview;
    vi.spyOn(previewOwner, 'executeWeeklyPlanningStableV5Preview').mockImplementation(params => {
      const preview = actual(params); const candidate = preview.candidates[0];
      const changed = { ...candidate, allocationBreakdown: mode === 'stale' ? { ...candidate.allocationBreakdown!, allocatedMinutes: 60, marginMinutes: 0 } : undefined };
      return { ...preview, candidates: mode === 'mixed' ? [candidate, changed] : [changed] };
    });
    const run = await execute(); expect(run.result.draftCandidates.length).toBeGreaterThan(0); expect(allocation(run.result)).toBeUndefined();
    completion.mockRejectedValue(new Error('scripted failure'));
    await renderWeeklyPlanningStableV5AssistantMessage(run);
    const prompt = JSON.parse(completion.mock.calls[0][0].messages[1].content);
    expect(prompt.applicationDecision).not.toHaveProperty('allocationBreakdown');
    expect(prompt.request).not.toContain('見積もり・余裕の内訳はUI表示に任せ');
  });
  it('does not promote discussed work to fresh allocation evidence', async () => {
    const run = await execute('page', 'discuss'); expect(run.result.draftCandidates).toEqual([]); expect(allocation(run.result)).toBeUndefined();
    completion.mockRejectedValue(new Error('scripted failure'));
    await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision).not.toHaveProperty('allocationBreakdown');
  });
  it('does not describe a retained preview as newly allocated after a no-op reply', async () => {
    const first = await execute();
    finalizeWeeklyPlanningStableV5RuntimeGraph({ ownerId: USER, conversationId: CONVERSATION, requestId: first.input.traceRequestId });
    const { document } = fixture();
    const next: WeeklyPlanningSemanticDocumentV5 = { ...document, planningIntent: 'discuss', planningWindow: null, tasks: [], conversationActs: [{ kind: 'topic_shift', targetPublicId: null }] };
    const input = { ...first.input, userText: 'ありがとう', traceRequestId: 'retained-allocation-turn', previousState: first.result.state, retainedPreviewCount: first.result.draftCandidates.length };
    accept(next, input.userText);
    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input);
    expect(result.preserveExistingPreview).toBe(true); expect(result.draftCandidates).toEqual([]); expect(allocation(result)).toBeUndefined();
    completion.mockImplementation(async request => response(request, 'どういたしまして。'));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage({ input, result });
    expect(rendered.responseSource).toBe('ai');
    const prompt = JSON.parse(completion.mock.calls[0][0].messages[1].content);
    expect(prompt.applicationDecision).not.toHaveProperty('allocationBreakdown');
    expect(prompt.request).not.toContain('見積もり・余裕の内訳はUI表示に任せ');
  });
  it('does not forward stale evidence attached to a retained preview result', async () => {
    const run = await execute();
    run.result.preserveExistingPreview = true;
    completion.mockRejectedValue(new Error('scripted failure'));
    await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision).not.toHaveProperty('allocationBreakdown');
  });
  it('keeps the existing one-call failure and unsaved-preview state', async () => {
    const run = await execute(); const before = structuredClone(run.result);
    completion.mockRejectedValue(new Error('scripted failure'));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('deterministic_fallback'); expect(rendered.message).toBe(before.message);
    expect(rendered.draftCandidates).toEqual(before.draftCandidates); expect(rendered.state).toEqual(before.state);
    expect(completion).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('persists the actual new diagnostic/provider request through reset retry and Worker (large=%s)', async large => {
    const run = await execute();
    const remembered = vi.spyOn(rendererTraceOwner, 'rememberWeeklyPlanningDialogueRendererPromptContext');
    completion.mockImplementation(async request => response(request, `数学の教材の候補を作成しました。「${CONTROL}」から確認できます。`));
    const rendered = await renderWeeklyPlanningStableV5AssistantMessage(run);
    expect(rendered.responseSource).toBe('ai');
    const trace = structuredClone(rendered.dialogueRendererTrace!);
    const context = remembered.mock.calls.find(([actionId]) => actionId === trace.actionId)?.[1] as Record<string, unknown>;
    expect(context).toBeDefined();
    expect(context.messages).toEqual(completion.mock.calls[0][0].messages);
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).request).toContain('previewCount counts blocks in ONE preview');
    expect(JSON.parse(completion.mock.calls[0][0].messages[1].content).applicationDecision.allocationBreakdown).toEqual(allocation(run.result));
    trace.request!.promptContext = { futureAllocationSentinel: { preserved: true }, ...context, ...(large ? { largeFutureAllocation: 'allocation-data'.repeat(30_000) } : {}) };
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
    await recordWeeklyPlanningStableV5TurnTrace({ ...record, requestId: 'allocation-retry', dialogueRendererTrace: undefined });
    expect(writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);
    const first = writes[0]; const serialized = JSON.stringify(first.entries[0]);
    expect(serialized).toContain('futureAllocationSentinel');
    expect(first.entries[0].kind).toBe('turn_diagnostic');
    if (first.entries[0].kind !== 'turn_diagnostic') throw new Error('missing persisted diagnostic');
    const storedPrompt = persistedPromptContext(first.entries[0]);
    const storedPromptJson = JSON.stringify(storedPrompt);
    expect(storedPromptJson).toContain('futureAllocationSentinel');
    expect(storedPromptJson).toContain('allocationBreakdown');
    expect(storedPromptJson).toContain('estimatedMinutes');
    expect(storedPromptJson).toContain('allocatedMinutes');
    if (!large) expect(storedPrompt).toEqual(trace.request!.promptContext);
    if (large) expect(storedPromptJson).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(first.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: first.session as unknown as Record<string, unknown>, entries: first.entries as unknown as Record<string, unknown>[] },
      { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, { sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-08-24T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1); expect(JSON.stringify(prepared.entries[0])).toContain('futureAllocationSentinel');
    expect(persistedPromptContext(prepared.entries[0])).toEqual(storedPrompt);
    if (large) expect(JSON.stringify(prepared.entries[0])).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});
