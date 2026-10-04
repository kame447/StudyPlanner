import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { choiceRequest, choiceEvaluation } from '../../../../shared/candidateChoiceFixtures.testUtils';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createCandidateChoiceClient } from '../../../services/ai/candidateChoiceClient';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { recordWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';
const userId = 'numeric-choice-owner'; const conversationId = 'weekly-conversation-323e4567-e89b-52d3-a456-426614174000';
let restore: () => void;
beforeEach(() => { restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage); resetWeeklyPlanningStableV5TraceRuntimeForTest(); });
afterEach(() => { resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); restore(); });
function repository() {
  const writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[] = []; let fail = false;
  const port: WeeklyPlanningTraceRepository = { async upsertSession() {}, async appendEntries(p) { if (fail) { fail = false; throw new Error('injected append failure'); } writes.push(structuredClone(p)); }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; } };
  return { port, writes, failNext() { fail = true; } };
}
async function dispatchAndTrace(oversized = false) {
  const r = choiceRequest(); const requestId = `${conversationId}:request:choice`;
  const scope = { ...r.context.scope, futureNumericChoiceSentinel: 'keep-unknown-numeric-sentinel', ...(oversized ? { largeValue: 'あ'.repeat(15000) } : {}) };
  const request = { ...r, context: { ...r.context, scope } }; let serializedBody = '';
  const client = createCandidateChoiceClient({ semanticPolicy: { calibrationEvidenceId: 'synthetic-test-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 },
    proxyUrl: 'https://fixture.invalid', getToken: async () => 'auth-secret-never-trace', semanticCensus: { sentinel: 'census-never-trace' },
    transport: async (_input, init) => { serializedBody = String(init?.body); return Response.json(choiceEvaluation(request)); } });
  await client.choose(request, () => {
    const { wholeUtterance, ...candidateChoiceRequest } = request;
    // Exercise the actual stage projection; future raw transport fields must not leak.
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_provider_request', data: { attempt: 'numeric_pending_choice', requestBytes: JSON.stringify(request).length,
      request: { purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: wholeUtterance }], candidateChoiceRequest: { ...candidateChoiceRequest, token: 'token-never-trace', ownerId: 'owner-never-trace', semanticCensus: 'census-never-trace' } } } });
  });
  const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
  expect(JSON.parse(serializedBody).decisionContext.request.context.scope.futureNumericChoiceSentinel).toBe('keep-unknown-numeric-sentinel');
  return { userId, conversationId, requestId, userText: r.wholeUtterance, assistantMessage: '確認しました', responseSource: 'ai' as const, outcome: 'discuss', previewCount: 0, debugTraceEvents: events };
}
function prepare(write: ReturnType<typeof repository>['writes'][number]) {
  return prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>, entries: write.entries as unknown as Record<string, unknown>[] },
    { token: `wpt_${'d'.repeat(43)}`, epoch: '103' }, { sessionId: 'weekly-trace-323e4567-e89b-52d3-a456-426614174000', logicalConversationId: conversationId }, '2026-10-05T00:00:00.000Z');
}
describe('actual Choice request through durable trace gate', () => {
  it('preserves question/target/scope/menu/hash/epoch and future sentinel through failed append, outbox retry and Worker preparation', async () => {
    const h = repository(); h.failNext(); setWeeklyPlanningTraceRepositoryForTests(h.port);
    const input = await dispatchAndTrace(); await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(h.writes).toHaveLength(0); expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${conversationId}:request:retry`, debugTraceEvents: [] });
    expect(h.writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
    const entry = h.writes[0].entries[0]; expect(entry.kind).toBe('turn_diagnostic');
    const serialized = JSON.stringify(entry);
    for (const marker of ['keep-unknown-numeric-sentinel', 'missing_effort_estimate', 'question-1', 'workload-1', 'sha256:', 'selectionEpoch', 'precision', 'exact']) expect(serialized).toContain(marker);
    for (const marker of ['auth-secret-never-trace', 'token-never-trace', 'owner-never-trace', 'census-never-trace']) expect(serialized).not.toContain(marker);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepare(h.writes[0]); expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain('keep-unknown-numeric-sentinel');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
  it('keeps the whole diagnostic with explicit oversized-menu truncation and server budget', async () => {
    const h = repository(); setWeeklyPlanningTraceRepositoryForTests(h.port);
    await recordWeeklyPlanningStableV5TurnTrace(await dispatchAndTrace(true));
    expect(h.writes).toHaveLength(1); const entry = h.writes[0].entries[0];
    expect(JSON.stringify(entry)).toContain('truncated'); expect(JSON.stringify(entry)).toContain('originalBytes');
    expect(JSON.stringify(entry)).not.toContain('あ'.repeat(15000));
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    expect(measureWeeklyPlanningTraceJsonBytes(prepare(h.writes[0]).entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});
