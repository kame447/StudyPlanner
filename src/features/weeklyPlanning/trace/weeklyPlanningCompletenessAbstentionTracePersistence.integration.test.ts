import { afterEach, expect, it } from 'vitest';
import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { beginWeeklyPlanningStableV5DebugTrace, recordWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';

/*
 * Issue #488 round 4b: the reason the completeness audit kept the first reading (`reason`, `step`, route) is
 * persisted in the turn diagnostic for every selecting route; here the size-gated dense route, which
 * recorded no abstention and whose persisted diagnostic dropped the audit block without an eligibility event.
 */
const OWNER = 'abstention-trace-owner';
const CONVERSATION = 'weekly-conversation-723e4567-e89b-42d3-a456-426614174000';
const SENTINEL = 'future-abstention-field';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let restoreStorage: () => void;
afterEach(() => {
  provider?.restore(); restoreStorage?.(); resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined);
});

type Json = Record<string, unknown>;
const FILLER = 'それぞれ自分のペースで、無理のない範囲で取り組みたいと思っています。';
function denseText(): string {
  let text = '来週、数学を10問進めたいです。物理を10問進めたいです。化学を10問も追加します。';
  while (new TextEncoder().encode(text).length < 1300) text += FILLER;
  return text;
}
function document(titles: string[]): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: titles.map((title, index) => ({
      localId: `task-${index}`, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title,
      study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: title, components: [] },
      workloads: [{ localId: `workload-${index}`, quantityRole: 'target', amount: 10, unitCode: 'problem', unitLabel: '問',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: `${title}を10問` }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: `${title}を10問`,
    })),
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    conversationActs: [], uncertainties: [], corrections: [], decisions: [],
  };
}

it('persists the abstention reason and step of the dense route through outbox retry, Worker preparation, caps and future fields', async () => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  let semanticCalls = 0;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '数学と物理は、それぞれ1問あたり何分くらいかかりそうですか？');
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify({ decision: 'incomplete', missingFacts: ['x'] });
    semanticCalls += 1;
    // The re-read drops a retained fact, so the first reading is kept: initial_facts_not_preserved.
    return JSON.stringify(document(semanticCalls === 1 ? ['数学', '物理'] : ['数学', '化学']));
  }, { completenessAudit: 'scripted' });
  const turn = await createScriptedConversation({ provider, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1' }).submit(denseText());
  expect(turn.result?.communicationFacts?.possibleCompletenessOmission).toBe(true);
  // The renderer context stays boolean-only: the reason is trace evidence, never prompt input.
  const rendererRequest = JSON.parse(turn.calls.find((call) => call.kind === 'renderer')!.messages.find((m) => m.role === 'user')!.content) as Json;
  expect(JSON.stringify(rendererRequest)).not.toContain('initial_facts_not_preserved');
  const abstained = turn.debugTrace.find((entry) => entry.stage === 'semantic_evidence_coverage_abstained');
  expect(abstained?.data).toMatchObject({ route: 'dense_turn_completeness_audit', reason: 'initial_facts_not_preserved', step: 'retry' });

  const traceInput = {
    userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: denseText(),
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, outcome: 'question' as const,
    debugTraceEvents: turn.debugTrace, previewCount: 0,
  };
  const extend = (large: boolean) => {
    const requestId = `${CONVERSATION}:request:${large ? 'large' : 'future'}`;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_evidence_coverage_abstained', data: {
      ...(abstained!.data as Json), futureAbstention: SENTINEL, ...(large ? { futureLargeValue: 'あ'.repeat(30_000) } : {}),
    } });
    return { ...traceInput, requestId, debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(requestId) };
  };
  const future = extend(false);
  const large = extend(true);
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) {
      if (fail) { fail = false; throw new Error('first abstention trace append failed'); }
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
  }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, { sessionId: 'weekly-trace-723e4567-e89b-42d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-10-07T00:00:00.000Z').entries);
  for (const entry of entries) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  for (const entry of prepared) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  for (const set of [entries, prepared]) {
    const text = (id: string) => JSON.stringify(set.find((entry) => (entry as unknown as { requestId: string }).requestId === id));
    for (const marker of ['evidenceCoverageAudit', 'abstention', 'initial_facts_not_preserved', 'dense_turn_completeness_audit']) {
      expect(text(turn.requestId!)).toContain(marker);
    }
    expect(text(future.requestId)).toContain(SENTINEL);
    expect(text(large.requestId)).toMatch(/traceTruncated|traceProjectionTruncated|truncated/u);
    expect(text(large.requestId)).not.toContain('あ'.repeat(30_000));
  }
});
