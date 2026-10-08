import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, expect, it } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import captured from '../testUtils/weeklyPlanningRound2DurationFixture.json';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply, type ScriptedConversation } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession, WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';

type Json = Record<string, unknown>;
const OWNER = 'duration-capture-owner';
const CONVERSATION = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174041';
const SENTINEL = 'future-preference-coverage';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let restoreStorage: () => void;
afterEach(() => { provider?.restore(); restoreStorage?.(); resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); });

it.each(['recovered', 'malformed_audit', 'lossy_retry'] as const)('persists the preference coverage decision through retry/Worker/future fields (%s)', async scenario => {
  const abstain = scenario === 'malformed_audit';
  const fixture = captured.omittedNight;
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  let conversation: ScriptedConversation;
  let followups = 0;
  const bind = (document: unknown) => JSON.stringify(document)
    .replace(/\$accepted-task-(\d+)/g, (_token, index: string) => conversation.graph()!.tasks[Number(index)].id);
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return abstain ? 'invalid audit fixture' : JSON.stringify({ decision: 'incomplete', missingFacts: ['night preference on both accepted tasks'] });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null });
    if (call.payload?.userText === fixture.setupUserText) return JSON.stringify(fixture.setupDocument);
    const document = structuredClone(fixture.firstDocument);
    if (followups++ > 0) for (const [index, task] of document.tasks.entries()) Object.assign(task, { temporalConstraints: [{ localId: `night-${index}`, targetLocalId: task.localId,
      kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate', sourceText: 'どっちも夜がいい' }] });
    if (scenario === 'lossy_retry' && followups > 1) for (const task of document.tasks) { task.effortEstimates = []; task.recurrence = []; }
    return bind(document);
  }, { completenessAudit: 'scripted' });
  conversation = createScriptedConversation({ provider, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1', studyMaterials: fixture.materials as StudyMaterial[] });
  await conversation.submit(fixture.setupUserText);
  await conversation.submit('1ページ3分くらい');
  const turn = await conversation.submit(fixture.followupUserText);
  expect(turn.result?.failure).toBeUndefined();
  const audit = turn.calls.find(call => call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5')!;
  expect(audit.payload?.evidenceCoverageEligibility).toMatchObject({ eligible: true, maxUncoveredSpanCodePoints: 9 });
  const request = turn.debugTrace.find(event => event.stage === 'semantic_provider_request' && (event.data as Json).attempt === 'dense_completeness_audit')!.data as { request: { messages: unknown }; requestBytes: number };
  expect(request.request.messages).toEqual(audit.messages);
  expect(turn.calls.filter(call => call.kind !== 'renderer')).toHaveLength(abstain ? 2 : 3);
  const events = structuredClone(turn.debugTrace);
  const eligibility = events.find(event => event.stage === 'semantic_evidence_coverage_eligibility')!.data as Json;
  eligibility.futurePreferenceCoverage = SENTINEL;
  const kept = { userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: fixture.followupUserText,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, outcome: 'preview', previewCount: turn.result!.draftCandidates.length, debugTraceEvents: events };
  const large = structuredClone(kept);
  large.requestId = `${CONVERSATION}:oversized`;
  (large.debugTraceEvents.find(event => event.stage === 'semantic_evidence_coverage_eligibility')!.data as Json).futureLargeCoverage = '大'.repeat(30_000);
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) { if (fail) { fail = false; throw new Error('preference coverage append failure'); } writes.push(structuredClone(params)); },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(kept);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace(large);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
  expect(writes).toHaveLength(2);
  for (const [index, write] of writes.entries()) {
    const entry = write.entries[0] as WeeklyPlanningTraceTurnDiagnosticEntry;
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json, entries: write.entries as unknown as Json[] },
      { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, { sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174041', logicalConversationId: CONVERSATION }, '2026-10-07T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const persisted of [entry, prepared.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry]) {
      expect(persisted.constraintContext.scheduler?.preview?.candidateCount).toBe(3);
      if (index === 0) {
        const context = persisted.aiInterpreter.input.evidenceCoverageAudit as { eligibility: Json; abstention: Json | null };
        expect(context.eligibility).toMatchObject({ eligible: true, maxUncoveredSpanCodePoints: 9, futurePreferenceCoverage: SENTINEL });
        if (abstain) expect(context.abstention).toMatchObject({ reason: 'malformed_audit_response' });
        else if (scenario === 'lossy_retry') {
          expect(context.abstention).toMatchObject({ reason: 'initial_facts_not_preserved', step: 'retry' });
          expect(JSON.stringify(persisted.aiInterpreter.structuredResults)).toContain('completeness_floor:initial_facts_not_preserved');
          const accepted = persisted.aiInterpreter.structuredResults.filter(result => result.accepted);
          const floor = accepted[accepted.length - 1];
          expect(JSON.stringify(floor)).toContain('session_duration');
          expect(JSON.stringify(floor)).not.toContain('preferred_window');
          expect(persisted.constraintContext.scheduler?.preview?.representativeCandidates.every(candidate => (candidate as Json).durationMinutes as number <= 60)).toBe(true);
        } else {
          expect(JSON.stringify(persisted.aiInterpreter.structuredResults)).toContain('preferred_window');
          expect(persisted.constraintContext.scheduler?.preview?.representativeCandidates.every(candidate => { const time = (candidate as Json).startTime; return typeof time === 'string' && time >= '21:00'; })).toBe(true);
        }
        expect(JSON.stringify(persisted.aiInterpreter.input.requests)).toContain(fixture.followupUserText);
      } else {
        expect(JSON.stringify(persisted)).toMatch(/traceTruncated|traceProjectionTruncated|truncated/u);
        expect(JSON.stringify(persisted)).not.toContain('大'.repeat(30_000));
      }
    }
  }
});

it('persists a dense spent-repair floor through the same seven boundary gates', async () => {
  const { coverageDocument, COVERAGE_USER_TEXT } = await import('../testUtils/weeklyPlanningSemanticEvidenceCoverageFixture');
  const { WeeklyPlanningSemanticNormalizerRunV5, SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES } = await import('../semantic/weeklyPlanningSemanticNormalizerRunV5');
  const { tryWeeklyPlanningDenseTurnCompletenessRetryV5 } = await import('../semantic/weeklyPlanningSemanticDenseTurnCompletenessV5');
  const { beginWeeklyPlanningStableV5DebugTrace, recordWeeklyPlanningStableV5DebugTrace, readWeeklyPlanningStableV5DebugTrace } = await import('./weeklyPlanningStableV5DebugTrace');
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  const initial = coverageDocument(false); const invalid = coverageDocument(true);
  invalid.tasks[0].workloads[0].amount = -1;
  const requestId = `${CONVERSATION}:spent`;
  // Cross the dense threshold while keeping the literal utterance inside the
  // persisted request's 1,500-byte message projection. Oversize is tested below.
  const userText = COVERAGE_USER_TEXT + ' '.repeat(SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES + 1
    - new TextEncoder().encode(COVERAGE_USER_TEXT).byteLength);
  expect(new TextEncoder().encode(userText).byteLength).toBe(SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES + 1);
  const requests: unknown[] = [];
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_validation_result', data: { attempt: 'initial', accepted: true, errors: [], parsedDocument: initial, conversationActs: [] } });
  const run = new WeeklyPlanningSemanticNormalizerRunV5({ async createChatCompletion(request) {
    requests.push(request.messages);
    return request.responseFormat?.type === 'json_schema' && request.responseFormat.json_schema.name === 'weekly_planning_dense_turn_completeness_audit_v5'
      ? JSON.stringify({ decision: 'incomplete', missingFacts: ['effort estimate'] }) : JSON.stringify(invalid);
  } }, { userText, conversationArchitecture: 'interaction_v1', traceRequestId: requestId });
  const result = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({ run, baseMessages: [], initialResponse: JSON.stringify(initial), initialDocument: initial, semanticRepairConsumed: () => true });
  expect(result?.status).toBe('accepted'); expect(result?.document).toEqual(initial);
  expect(result?.diagnostics.repairAttempted).toBe(true); expect(requests).toHaveLength(2);
  const events = readWeeklyPlanningStableV5DebugTrace(requestId);
  expect(events.filter(event => event.stage === 'semantic_provider_request').map(event => (event.data as { request: { messages: unknown } }).request.messages)).toEqual(requests);
  const floor = events.find(event => event.stage === 'semantic_validation_result' && (event.data as Json).attempt === 'completeness_floor:repair_budget_consumed')!;
  ((floor.data as Json).parsedDocument as Json).futureSpentFloor = SENTINEL;
  const kept = { userId: OWNER, conversationId: CONVERSATION, requestId, userText, assistantMessage: '教材を確認してください。', outcome: 'clarify', previewCount: 0, debugTraceEvents: events };
  const large = structuredClone(kept); large.requestId += ':oversized';
  ((large.debugTraceEvents.find(event => event.stage === 'semantic_validation_result' && (event.data as Json).attempt === 'completeness_floor:repair_budget_consumed')!.data as Json).parsedDocument as Json).futureLargeFloor = '大'.repeat(30_000);
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  setWeeklyPlanningTraceRepositoryForTests({ async upsertSession() {}, async appendEntries(params) { if (fail) { fail = false; throw new Error('spent floor append failure'); } writes.push(structuredClone(params)); }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; } });
  await recordWeeklyPlanningStableV5TurnTrace(kept);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(); await recordWeeklyPlanningStableV5TurnTrace(large);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]); expect(writes).toHaveLength(2);
  for (const [index, write] of writes.entries()) {
    const entry = write.entries[0] as WeeklyPlanningTraceTurnDiagnosticEntry;
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json, entries: write.entries as unknown as Json[] }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, { sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174041', logicalConversationId: CONVERSATION }, '2026-10-07T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1); expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const persisted of [entry, prepared.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry]) {
      if (index === 0) {
        const floor = persisted.aiInterpreter.structuredResults.find(result => result.attempt === 'completeness_floor:repair_budget_consumed');
        expect(floor).toMatchObject({ accepted: true });
        expect(JSON.stringify(floor?.structuredResult)).toContain('"amount":20');
        expect(JSON.stringify(persisted.aiInterpreter.input.requests)).toContain(userText);
        // Future fields survive in the existing unregistered parsed-document channel.
        expect(JSON.stringify(persisted)).toContain(SENTINEL);
      } else { expect(JSON.stringify(persisted)).toMatch(/traceTruncated|traceProjectionTruncated|truncated/u); expect(JSON.stringify(persisted)).not.toContain('大'.repeat(30_000)); }
    }
  }
});
