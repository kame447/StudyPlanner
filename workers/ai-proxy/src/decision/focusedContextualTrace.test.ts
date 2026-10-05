import { afterEach, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../../../src/features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { beginWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceTypes';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5';
import worker from '../worker';
import { JEV_MODEL } from './decisionPolicy';

let restoreStorage: (() => void) | undefined;
afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage?.();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('excludes the provider-only projection while persisting contextual diagnostics through outbox retry and Worker bounds', async () => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) {
      if (fail) { fail = false; throw new Error('offline initial append failure'); }
      writes.push(structuredClone(params));
    }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  const bodies: Array<Record<string, unknown>> = [];
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('identitytoolkit')) return Response.json({ users: [{ localId: 'trace-owner', emailVerified: true }] });
    if (!String(url).includes('/decisions')) throw new Error('Unexpected provider call');
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ model: JEV_MODEL.responses[1], answers: {
      contextual_answer: { type: 'choice', choice: 'remaining', confidence: 0.999,
        probabilities: { target: 0.0001, remaining: 0.9996, completed: 0.0001, focused_luna: 0.0001, fallback: 0.0001 } },
      condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 },
    } });
  }));
  const input = { userText: 'あとに残っている量です。', traceRequestId: 'contextual-trace-request',
    publicStateSummary: { graphRevision: 8, previousCompatibilityStatus: 'revision_pending',
      pendingQuestion: { questionCode: 'quantity_role_unresolved', targetFactId: 'workload-1', graphRevision: 8 },
      workloads: [{ publicId: 'workload-1', taskPublicId: 'task-1', componentPublicId: null,
        quantityRole: 'unknown', amount: 17, unitCode: 'page', unitLabel: 'ページ', rangeStart: null,
        rangeEnd: null, perOccurrence: false, periodExpression: null }],
      tasks: [{ publicId: 'task-1', category: 'study', title: '合成教材の演習' }], components: [], relations: [] } };
  beginWeeklyPlanningStableV5DebugTrace(input.traceRequestId);
  const normalizer = createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const pending: Promise<unknown>[] = [];
    const response = await worker.fetch(new Request('https://proxy.example/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer offline-session', Origin: 'https://app.example' },
      body: JSON.stringify({ purpose: request.purpose, messages: request.messages,
        response_format: request.responseFormat, decisionContext: request.decisionContext }),
    }), { OPENAI_API_KEY: 'offline-key', OPENROUTER_API_KEY: 'offline-key', FIREBASE_WEB_API_KEY: 'fixture-project',
      ALLOWED_ORIGIN: 'https://app.example', JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: 'canary', JEV_MODE: 'canary', JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100',
      AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 1 }) }) } } as never,
    { getToken: async () => 'unused' }, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as ExecutionContext);
    await Promise.all(pending);
    expect(response.status).toBe(200);
    return (await response.json() as { content: string }).content;
  } });
  const result = await normalizer.normalize(input);
  expect(result.status).toBe('accepted');
  expect(bodies).toHaveLength(1);
  expect(bodies[0].state).toMatchObject({ questionCode: 'quantity_role_unresolved' });
  const events = takeWeeklyPlanningStableV5DebugTrace(input.traceRequestId);
  const trace = { userId: 'trace-owner', conversationId: 'weekly-conversation-423e4567-e89b-52d3-a456-426614174000',
    requestId: input.traceRequestId, userText: input.userText, assistantMessage: '診断用メッセージ',
    responseSource: 'ai' as const, outcome: 'needs_information', debugTraceEvents: events, previewCount: 0 };
  await recordWeeklyPlanningStableV5TurnTrace(trace);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems(trace)).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace({ ...trace, requestId: 'contextual-trace-retry', debugTraceEvents: [] });
  expect(writes).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems(trace)).toEqual([]);
  const replayed = writes[0];
  const serialized = JSON.stringify(replayed.entries);
  expect(serialized).toContain('focused_contextual_answer');
  expect(serialized).toContain('quantity_role_answer');
  expect(serialized).toContain('requestBytes');
  expect(serialized).not.toContain('decisionContext');
  // Existing Luna prompt diagnostics include the original pending question.
  // The extra Jev envelope/projection and catalog remain excluded.
  expect(serialized).not.toContain('hasEstimateTarget');
  expect(serialized).not.toContain('targetQuantityRole');
  expect(serialized).not.toContain('"contextual_answer"');
  expect(measureWeeklyPlanningTraceJsonBytes(replayed.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  const prepared = prepareWeeklyPlanningTraceServerWrite({ session: replayed.session as unknown as Record<string, unknown>,
    entries: replayed.entries as unknown as Record<string, unknown>[] },
  { token: `wpt_${'c'.repeat(43)}`, epoch: '102' },
  { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: trace.conversationId }, '2026-10-04T00:00:00Z');
  expect(JSON.stringify(prepared.entries)).toContain('quantity_role_answer');
  expect(JSON.stringify(prepared.entries)).not.toContain('decisionContext');
  expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
});
