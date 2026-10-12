import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { runRequiredUncertaintyRateFixture, REQUIRED_UNCERTAINTY_ANSWER } from '../testUtils/__tests__/weeklyPlanningRequiredUncertaintyFixture';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from './weeklyPlanningStableV5DebugTrace';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';

const USER = 'required-uncertainty-trace-owner';
const CONVERSATION = 'weekly-conversation-923e4567-e89b-52d3-a456-426614174000';
const SENTINEL = 'future-required-question-detail';
let restoreStorage: (() => void) | undefined;
beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in required-uncertainty trace gate'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined); restoreStorage?.();
});

it('persists the actual rate turn and required need through retry, Worker, future fields and byte limits', async () => {
  const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  // Production normalizer and requests with completely scripted client transport.
  const result = await runRequiredUncertaintyRateFixture(true, CONVERSATION, document => createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) { requests.push(request); return JSON.stringify(document); } }));
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(result.second.canonicalization?.status, JSON.stringify(result.second)).toBe('applied');
  expect(result.after.uncertainties).toContainEqual(result.originalNeed);
  const rate = result.after.effortEstimates.find(e => e.kind === 'duration_per_unit' && e.minutes === 3)!;
  expect(rate).toMatchObject({ targetFactId: result.before.workloads[0].id, unitCode: 'problem' });
  expect(result.second.scheduler?.status).toBe('needs_resolution');
  const decoded = parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(result.second.graph));
  expect(decoded.errors).toEqual([]); expect(decoded.graph).toEqual(result.second.graph);
  const actualRequest = result.debugTrace.find(event => event.stage === 'semantic_provider_request');
  expect(actualRequest).toBeDefined();
  expect(JSON.stringify(actualRequest!.data)).toContain(REQUIRED_UNCERTAINTY_ANSWER);

  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let firstWrite = true;
  const repository: WeeklyPlanningTraceRepository = { async upsertSession() {}, async appendEntries(params) {
    if (firstWrite) { firstWrite = false; throw new Error('injected required-uncertainty trace append failure'); }
    writes.push(structuredClone(params));
  }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; } };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  const debugTraceEvents = structuredClone(result.debugTrace);
  const canonicalization = debugTraceEvents.find(event => event.stage === 'semantic_canonicalization_evaluated')!;
  const data = canonicalization.data as { adoptedOperations: Record<string, unknown> };
  data.adoptedOperations.futureRequiredQuestionDetail = SENTINEL;
  const base = { userId: USER, conversationId: CONVERSATION, requestId: 'required-question-rate', userText: REQUIRED_UNCERTAINTY_ANSWER, assistantMessage: '教材を確認してください。', responseSource: 'deterministic_fallback' as const, outcome: 'scheduler_needs_resolution', previewCount: 0, debugTraceEvents };
  await recordWeeklyPlanningStableV5TurnTrace(base);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace({ ...base, requestId: 'required-question-retry-trigger' });
  expect(writes).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);

  const large = structuredClone(base);
  large.requestId = 'required-question-large';
  const largeEvent = large.debugTraceEvents.find(event => event.stage === 'semantic_canonicalization_evaluated')!;
  (largeEvent.data as { adoptedOperations: Record<string, unknown> }).adoptedOperations.futureLargeDetail = 'あ'.repeat(30_000);
  await recordWeeklyPlanningStableV5TurnTrace(large);
  expect(writes).toHaveLength(3);
  for (const [index, write] of writes.entries()) {
    expect(write.entries).toHaveLength(1);
    const entry = write.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>, entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, { sessionId: 'weekly-trace-923e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-08-12T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const value of [entry, prepared.entries[0]]) {
      const serialized = JSON.stringify(value);
      if (index < 2) {
        for (const evidence of [result.originalNeed.id, rate.id, 'semantic_uncertainty', SENTINEL, REQUIRED_UNCERTAINTY_ANSWER]) expect(serialized).toContain(evidence);
      } else {
        expect(serialized).toMatch(/traceTruncated|truncation/);
        expect(serialized).not.toContain('あ'.repeat(30_000));
      }
    }
  }
});
