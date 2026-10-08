import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { REGISTERED_MATERIAL_BUDGET_CAPTURE as capture } from '../testUtils/weeklyPlanningRegisteredMaterialBudgetCaptureFixture';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { beginWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';
import { createWeeklyPlanningTurnDiagnosticV2 } from './weeklyPlanningTurnDiagnosticV2';

const OWNER = 'owner-time-budget-trace';
const CONVERSATION = 'weekly-conversation-323e4567-e89b-52d3-a456-426614174000';
const SENTINEL = 'future-audit-interpretation-field';
const subject = { token: `wpt_${'b'.repeat(43)}`, epoch: '101' };
const ids = { sessionId: 'weekly-trace-323e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION };

function repositoryHarness() {
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(input) {
      if (fail) { fail = false; throw new Error('injected audit trace append outage'); }
      writes.push(structuredClone(input));
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  return { writes, repository };
}

async function actualTrace(requestId: string, mixed: boolean, repair = false) {
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  let count = 0;
  const sentRequests: unknown[] = [];
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(input) {
    count += 1;
    sentRequests.push(input.messages);
    if (input.responseFormat?.json_schema.name === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify({
      ...capture.audit, missingFacts: mixed ? [...capture.audit.missingFacts, 'a separate omitted proposition'] : capture.audit.missingFacts,
      timeBudgets: [{ kind: 'registered_material_timebox', omissionIndex: 0, materialLabel: '合成研究メモ',
        amount: 2, unitCode: 'hour', valueText: '2', precision: 'exact', sourceText: '合成研究メモを2時間進めたい' }],
      otherMissingFactIndexes: mixed ? [1] : [],
    });
    if (repair && count === 3) return 'invalid json';
    return JSON.stringify(count === 1 ? capture.initialDocument : capture.rereadDocument);
  } }).normalize({ userText: capture.initialUserText, traceRequestId: requestId, conversationArchitecture: 'interaction_v1',
    publicStateSummary: { tasks: [], components: [], workloads: [], registeredMaterials: [
      { materialId: 'fixture-material-1', name: '合成研究メモ' }, { materialId: 'fixture-material-2', name: '合成演習帳' },
    ] } });
  expect(result.status).toBe('accepted');
  expect(count).toBe(repair ? 4 : mixed ? 3 : 2);
  expect(result.diagnostics.repairAttempted).toBe(repair);
  const note = result.document?.tasks.find(task => task.title === '合成研究メモ');
  expect(note?.effortEstimates[0].minutes).toBe(120);
  const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
  expect(events.filter(event => event.stage === 'semantic_provider_request')
    .map(event => (event.data as { request: { messages: unknown } }).request.messages)).toEqual(sentRequests);
  const route = events.find(event => event.stage === 'semantic_orchestrator_route'
    && (event.data as Record<string, unknown>).route === 'audit_authored_registered_material_timebox'
    && (event.data as Record<string, unknown>).phase === (repair ? 'repair' : mixed ? 'reread' : 'initial'));
  expect(route).toBeDefined();
  expect(JSON.stringify(route)).toContain(note!.localId);
  expect(JSON.stringify(route)).toContain(note!.effortEstimates[0].localId);
  expect(JSON.stringify(route)).toContain('合成研究メモを2時間進めたい');
  expect(JSON.stringify(route)).toContain('"valueText":"2"');
  return { events, note: note! };
}

function input(requestId: string, events: Awaited<ReturnType<typeof actualTrace>>['events']) {
  return { userId: OWNER, conversationId: CONVERSATION, requestId, userText: capture.initialUserText,
    assistantMessage: '読み進める速さを教えてください。', responseSource: 'ai' as const, outcome: 'needs_clarification',
    debugTraceEvents: events, previewCount: 0 };
}
let restore: (() => void) | undefined;
beforeEach(() => {
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});
afterEach(() => {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restore?.(); restore = undefined;
});

describe('audit-authored timebox trace persistence gate', () => {
  it.each([{ phase: 'initial', mixed: false, repair: false }, { phase: 'reread', mixed: true, repair: false },
    { phase: 'repair', mixed: true, repair: true }])('preserves actual authorship through durable retry and Worker preparation ($phase)', async ({ phase, mixed, repair }) => {
    const requestId = `${CONVERSATION}:request:${phase}`;
    const actual = await actualTrace(requestId, mixed, repair);
    // Unknown trace metadata uses the established open envelope, without a Worker schema addition.
    const route = actual.events.find(event => (event.data as Record<string, unknown>).route === 'audit_authored_registered_material_timebox')!;
    (route.data as Record<string, unknown>).futureAuditTraceField = SENTINEL;
    const harness = repositoryHarness(); setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    await recordWeeklyPlanningStableV5TurnTrace(input(requestId, actual.events));
    expect(harness.writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(input(`${requestId}-retry`, []));
    expect(harness.writes).toHaveLength(2);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const replayed = harness.writes[0]; const entry = replayed.entries[0]; const text = JSON.stringify(entry);
    expect(entry.requestId).toBe(requestId);
    for (const evidence of [actual.note.localId, actual.note.effortEstimates[0].localId, 'completeness_audit', 'audit_authored', SENTINEL]) expect(text).toContain(evidence);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: replayed.session as unknown as Record<string, unknown>,
      entries: replayed.entries as unknown as Record<string, unknown>[] }, subject, ids, '2026-10-08T00:00:00.000Z');
    const serverText = JSON.stringify(prepared.entries[0]);
    for (const evidence of [actual.note.localId, actual.note.effortEstimates[0].localId, 'completeness_audit', SENTINEL]) expect(serverText).toContain(evidence);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });

  it('bounds oversized interpretation diagnostics explicitly before durable and Worker writes', async () => {
    const actual = await actualTrace(`${CONVERSATION}:request:oversized`, false);
    const oversized = 'oversized-audit-evidence-'.repeat(4000);
    actual.events.push({ schemaVersion: 2, sequence: actual.events.length, stage: 'semantic_orchestrator_route',
      occurredAt: '2026-10-08T00:00:00.000Z', severity: 'debug', data: {
        route: 'audit_authored_registered_material_timebox', oversizedEvidence: oversized,
      } });
    const harness = repositoryHarness(); setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    await recordWeeklyPlanningStableV5TurnTrace(input(`${CONVERSATION}:request:oversized`, actual.events));
    await recordWeeklyPlanningStableV5TurnTrace(input(`${CONVERSATION}:request:oversized-retry`, []));
    const replayed = harness.writes[0]; const entry = replayed.entries[0];
    expect(JSON.stringify(entry)).not.toContain(oversized);
    expect(JSON.stringify(entry)).toContain('"traceTruncated":true');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: replayed.session as unknown as Record<string, unknown>,
      entries: replayed.entries as unknown as Record<string, unknown>[] }, subject, ids, '2026-10-08T00:00:00.000Z');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });

  it.each(['legacy', 'ordinary_interaction'] as const)('keeps the full pre-change diagnostic bytes when no new route occurs: %s', architecture => {
    const doc = JSON.parse(JSON.stringify(capture.initialDocument));
    doc.tasks[0].existingPublicId = null;
    if (architecture === 'legacy') delete doc.conversationActs;
    const events = [{ schemaVersion: 2 as const, sequence: 0, stage: 'semantic_validation_result',
      occurredAt: '2026-10-08T00:00:00.000Z', severity: 'debug' as const,
      data: { attempt: 'initial', accepted: true, errors: [], parsedDocument: doc } }];
    if (architecture === 'ordinary_interaction') events.push({
      schemaVersion: 2, sequence: 1, stage: 'semantic_evidence_coverage_eligibility',
      occurredAt: '2026-10-08T00:00:00.000Z', severity: 'debug',
      data: { route: 'partial_leaf_evidence_coverage', eligible: false, coveredCodePoints: 9, maxUncoveredSpanCodePoints: 0 },
    } as unknown as typeof events[number]);
    const diagnostic = createWeeklyPlanningTurnDiagnosticV2({
      id: 'fixed-trace-entry', sessionId: ids.sessionId, logicalConversationId: CONVERSATION,
      sequence: 0, turnIndex: 0, requestId: 'fixed-request', occurredAt: '2026-10-08T00:00:00.000Z',
      observedAt: '2026-10-08T00:00:01.000Z', expireAt: '2027-01-06T00:00:00.000Z',
      userText: '来週、合成演習帳を20ページ読む', assistantMessage: '速さを教えてください。',
      outcome: 'needs_clarification', previewCount: 0, debugTraceEvents: events,
    });
    const hash = createHash('sha256').update(JSON.stringify(diagnostic)).digest('hex');
    // Captured on exact f866b197 before either proposed trace hunk.
    const baseline = { legacy: '5e0e8af5ca73f533e2353b4ef8c730640db0dfeb51611608ea14032139250858',
      ordinary_interaction: '7bf30d7e4e99a3a095cbb410af0ed3ed291da442ce93a317aac566dc480fb294' };
    expect(hash).toBe(baseline[architecture]);
  });
});
