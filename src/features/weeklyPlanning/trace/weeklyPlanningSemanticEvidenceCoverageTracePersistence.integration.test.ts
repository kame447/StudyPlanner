import { afterEach, expect, it } from 'vitest';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { COVERAGE_USER_TEXT, coverageDocument, coverageRendererReply } from '../testUtils/weeklyPlanningSemanticEvidenceCoverageFixture';
import { beginWeeklyPlanningStableV5DebugTrace, recordWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';

const OWNER = 'coverage-trace-owner';
const CONVERSATION = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174000';
const SENTINEL = 'future-leaf-evidence-eligibility';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let restoreStorage: () => void;
afterEach(() => {
  provider?.restore(); restoreStorage?.(); resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined);
});

it.each([false, true])('persists eligibility and optional abstention through retry/Worker/future fields (abstain: %s)', async (abstain) => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  let generic = 0;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return coverageRendererReply(call);
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return abstain ? 'invalid audit response' : JSON.stringify({ decision: 'incomplete', missingFacts: ['rate and weekday availability'] });
    return JSON.stringify(coverageDocument(generic++ > 0));
  }, { completenessAudit: 'scripted' });
  const turn = await createScriptedConversation({ provider, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1' }).submit(COVERAGE_USER_TEXT);
  expect(turn.result?.failure).toBeUndefined();
  const audit = turn.calls.find((call) => call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5')!;
  expect(audit.payload?.evidenceCoverageEligibility).toMatchObject({ route: 'partial_leaf_evidence_coverage', eligible: true, maxUncoveredSpanCodePoints: 27 });
  const event = turn.debugTrace.find((entry) => entry.stage === 'semantic_provider_request'
    && (entry.data as { attempt?: string }).attempt === 'dense_completeness_audit')!;
  expect((event.data as { request: { messages: unknown } }).request.messages).toEqual(audit.messages);
  const traceInput = {
    userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: COVERAGE_USER_TEXT,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, outcome: turn.result!.draftCandidates.length ? 'preview' : 'question',
    debugTraceEvents: turn.debugTrace, previewCount: turn.result!.draftCandidates.length,
  };
  const extend = (large: boolean) => {
    const requestId = `${CONVERSATION}:request:${large ? 'large' : 'future'}`;
    const data = structuredClone(event.data) as { attempt: string; request: { messages: Array<{ role: string; content: string }> } };
    const user = data.request.messages.find((message) => message.role === 'user')!;
    const payload = JSON.parse(user.content) as { evidenceCoverageEligibility: Record<string, unknown> };
    payload.evidenceCoverageEligibility.futureEligibility = SENTINEL;
    if (large) payload.evidenceCoverageEligibility.futureLargeValue = 'あ'.repeat(30_000);
    user.content = JSON.stringify(payload);
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_provider_request', data });
    const eligibility = turn.debugTrace.find((entry) => entry.stage === 'semantic_evidence_coverage_eligibility')!.data as Record<string, unknown>;
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_evidence_coverage_eligibility', data: {
      ...eligibility, futureEligibility: SENTINEL, ...(large ? { futureLargeValue: 'あ'.repeat(30_000) } : {}),
    } });
    if (abstain) recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_evidence_coverage_abstained',
      data: turn.debugTrace.find((entry) => entry.stage === 'semantic_evidence_coverage_abstained')!.data });
    return { ...traceInput, requestId, debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(requestId) };
  };
  const future = extend(false);
  const large = extend(true);
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) {
      if (fail) { fail = false; throw new Error('first coverage trace append failed'); }
      writes.push(structuredClone(params));
    }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(traceInput);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace(future);
  await recordWeeklyPlanningStableV5TurnTrace(large);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
  const entries = writes.flatMap((write) => write.entries);
  expect(entries).toHaveLength(3);
  const prepared = writes.flatMap((write) => prepareWeeklyPlanningTraceServerWrite({
    session: write.session as unknown as Record<string, unknown>, entries: write.entries as unknown as Record<string, unknown>[],
  }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, { sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-10-07T00:00:00.000Z').entries);
  for (const entry of entries) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  for (const entry of prepared) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  for (const set of [entries, prepared]) {
    const text = (id: string) => JSON.stringify(set.find((entry) => (entry as unknown as { requestId: string }).requestId === id));
    for (const marker of ['evidenceCoverageEligibility', 'partial_leaf_evidence_coverage', 'maxUncoveredSpanCodePoints', '27']) expect(text(turn.requestId!)).toContain(marker);
    expect(text(turn.requestId!)).toContain('evidenceCoverageAudit');
    if (abstain) for (const marker of ['malformed_audit_response', 'abstention']) expect(text(turn.requestId!)).toContain(marker);
    expect(text(future.requestId)).toContain(SENTINEL);
    expect(text(large.requestId)).toMatch(/traceTruncated|traceProjectionTruncated|truncated/u);
    expect(text(large.requestId)).not.toContain('あ'.repeat(30_000));
  }
});
