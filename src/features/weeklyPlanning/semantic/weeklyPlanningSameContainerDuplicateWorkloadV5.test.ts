import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5, SemanticWorkloadV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningSemanticPipelineV5 } from './weeklyPlanningSemanticPipelineV5';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { readWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';

function workload(localId: string): SemanticWorkloadV5 {
  return { localId, quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null, sourceText: 'work20' };
}
function document(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null,
    tasks: [{ localId: 'task', category: 'study', title: 'work', study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [workload('first'), workload('copy')], effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: 'work20' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };
}
const TEXT = 'work20 separate work20 3分';
function validate(value: WeeklyPlanningSemanticDocumentV5) {
  return validateWeeklyPlanningSemanticResponseV5(JSON.stringify(value), { currentUserText: TEXT });
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('API0 network forbidden'); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  resetWeeklyPlanningStableV5DebugTraceForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); });

describe('H0560 exact sibling workload representation', () => {
  it('compacts unreferenced task copies after validating the original without changing evidence', () => {
    const input = document(); const before = structuredClone(input); const result = validate(input);
    expect(result.errors).toEqual([]); expect(result.document!.tasks[0].workloads).toEqual([workload('first')]);
    expect(result.algorithmicRepairs).toContain('same-container-workload-duplicate-removed:task:copy');
    expect(result.providerDocument!.tasks[0].workloads).toHaveLength(2); expect(input).toEqual(before);
  });
  it('compacts copies within one component and keeps that component identity', () => {
    const input = document(); input.tasks[0].workloads = []; input.tasks[0].study!.components = [{ localId: 'component', parentLocalId: null,
      role: 'subject', label: 'work', sourceText: 'work20', workloads: [workload('first'), workload('copy')] }];
    const result = validate(input); expect(result.errors).toEqual([]);
    expect(result.document!.tasks[0].study!.components[0]).toMatchObject({ localId: 'component', workloads: [workload('first')] });
  });
  it.each([
    { sourceText: 'separate work20' }, { amount: 21 }, { quantityRole: 'remaining' as const },
    { unitCode: 'page' as const, unitLabel: 'ページ' }, { unitLabel: 'problems' },
    { rangeStart: '21', rangeEnd: '40' }, { perOccurrence: true, periodExpression: 'every_day' },
  ])('does not merge a different typed/evidence payload: %j', difference => {
    const input = document(); input.tasks[0].workloads[1] = { ...input.tasks[0].workloads[1], ...difference };
    const result = validate(input); expect(result.errors).toEqual([]); expect(result.document!.tasks[0].workloads).toHaveLength(2);
  });
  it('does not coalesce equal values belonging to two components or two tasks', () => {
    const input = document(); input.tasks[0].workloads = []; input.tasks[0].study!.components = ['left', 'right'].map((localId, index) => ({
      localId, parentLocalId: null, role: 'subject', label: localId, sourceText: 'work20', workloads: [workload('work-' + index)] }));
    input.tasks.push({ ...structuredClone(input.tasks[0]), localId: 'other-task', study: { purpose: 'self_study', contextLabel: null, components: [] }, workloads: [workload('other-work')] });
    const result = validate(input); expect(result.errors).toEqual([]);
    expect(result.document!.tasks[0].study!.components.map(c => c.workloads.length)).toEqual([1, 1]);
    expect(result.document!.tasks[1].workloads).toHaveLength(1);
  });
  it.each(['effort', 'uncertainty'] as const)('rejects a referenced duplicate group without deleting or rebinding %s', kind => {
    const input = document();
    if (kind === 'effort') input.tasks[0].effortEstimates = [{ localId: 'pace', targetLocalId: 'copy', kind: 'duration_per_unit', minutes: 3,
      unitCode: 'problem', precision: 'exact', sourceText: '3分' }];
    else input.uncertainties = [{ localId: 'need', targetLocalId: 'copy', field: 'opaque', reason: 'opaque', sourceText: 'work20' }];
    const result = validate(input); expect(result.document).toBeNull();
    expect(result.errors).toContain('same-container-workload-duplicate-referenced:task:first,copy');
    expect(result.parsedDocument!.tasks[0].workloads).toHaveLength(2);
    expect(result.algorithmicRepairs.some(r => r.startsWith('same-container-workload-'))).toBe(false);
  });
  it('does not let compaction hide an invalid original duplicate localId', () => {
    const input = document(); input.tasks[0].workloads[1].localId = 'first';
    const result = validate(input); expect(result.document).toBeNull(); expect(result.errors.length).toBeGreaterThan(0);
    expect(result.algorithmicRepairs.some(r => r.startsWith('same-container-workload-'))).toBe(false);
  });
  it('does not compact or report repair for an original ungrounded workload', () => {
    const input = document(); input.tasks[0].workloads.forEach(item => { item.sourceText = 'not in the current turn'; });
    const result = validate(input); expect(result.document).toBeNull(); expect(result.errors.length).toBeGreaterThan(0);
    expect(result.parsedDocument!.tasks[0].workloads).toHaveLength(2);
    expect(result.algorithmicRepairs.some(r => r.startsWith('same-container-workload-'))).toBe(false);
  });
  it('does not alter agreeing effort estimates while compacting workloads', () => {
    const input = document(); input.tasks[0].effortEstimates = ['a', 'b'].map(localId => ({ localId, targetLocalId: 'task', kind: 'total_duration',
      minutes: 3, unitCode: null, precision: 'exact', sourceText: '3分' }));
    const result = validate(input); expect(result.errors).toEqual([]); expect(result.document!.tasks[0].effortEstimates).toEqual(input.tasks[0].effortEstimates);
  });
  it.each([false, true])('rejects referenced duplicates before unrelated repair can enter graph (dense=%s)', async dense => {
    const bad = document();
    bad.tasks[0].effortEstimates = [{ localId: 'pace', targetLocalId: 'copy', kind: 'duration_per_unit', minutes: 3,
      unitCode: 'problem', precision: 'exact', sourceText: '3分' }];
    const other = structuredClone(bad.tasks[0]); other.localId = 'english'; other.title = 'english'; other.sourceText = 'english7';
    other.effortEstimates = []; other.workloads = [{ ...workload('english-work'), amount: 7, unitCode: 'page', unitLabel: 'pages', sourceText: 'english7' }];
    bad.tasks.push(other);
    const repair = structuredClone(bad); repair.tasks[0].workloads = [repair.tasks[0].workloads[1]]; repair.tasks[1].workloads[0].amount = 999;
    const first = structuredClone(bad); first.tasks[0].workloads.pop(); first.tasks[0].effortEstimates[0].targetLocalId = 'first';
    const userText = TEXT + ' english7' + (dense ? ' padding'.repeat(800) : '');
    expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(bad), { currentUserText: userText }).errors)
      .toEqual(['same-container-workload-duplicate-referenced:task:first,copy']);
    // This response is independently valid in isolation: only route rejection protects the prior reading.
    expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(repair), { currentUserText: userText }).errors).toEqual([]);
    let generic = 0;
    const client = { createChatCompletion: vi.fn(async (request: any) => {
      if (request.responseFormat?.json_schema.name === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify({ decision: 'incomplete', missingFacts: ['detail'] });
      if (request.responseFormat?.json_schema.name === 'weekly_planning_semantic_document_v5') {
        generic += 1;
        return JSON.stringify(dense ? (generic === 1 ? first : generic === 2 ? bad : repair) : (generic === 1 ? bad : repair));
      }
      throw new Error('unexpected mock purpose');
    }) };
    const graph = createEmptyWeeklyPlanningFactGraphV5(); const before = structuredClone(graph);
    const result = await createWeeklyPlanningSemanticPipelineV5(createWeeklyPlanningSemanticNormalizerV5(client)).run({
      graph, conversationId: 'sol7-h0560-rejected', turnId: 'referenced', expectedRevision: graph.revision, userText,
      schedulerContext: { ownerId: 'sol7', currentDate: '2026-10-13', planningStartDate: '2026-10-12', planningEndDate: '2026-10-18', timeZone: 'Asia/Tokyo' } });
    expect(result.status).toBe('normalization_rejected'); expect(result.normalization.status).toBe('rejected');
    expect(result.normalization.diagnostics).toMatchObject({ attemptCount: dense ? 2 : 1, repairAttempted: false,
      validationErrors: ['same-container-workload-duplicate-referenced:task:first,copy'] });
    expect(result.graph).toBe(graph); expect(result.graph).toEqual(before); expect(graph).toEqual(before);
    expect(result.canonicalization).toBeNull(); expect(result.scheduler).toBeNull();
    expect(client.createChatCompletion).toHaveBeenCalledTimes(dense ? 3 : 1); expect(generic).toBe(dense ? 2 : 1);
  });
  it('keeps the independent target20 ledger through real dense reread and canonical commit', async () => {
    const first = document(); first.tasks[0].workloads.pop(); let generic = 0;
    const client = { createChatCompletion: vi.fn(async (request: any) => {
      if (request.responseFormat?.json_schema.name === 'weekly_planning_dense_turn_completeness_audit_v5') return JSON.stringify({ decision: 'incomplete', missingFacts: ['detail'] });
      if (request.responseFormat?.json_schema.name === 'weekly_planning_semantic_document_v5') return JSON.stringify(++generic === 1 ? first : document());
      throw new Error('unexpected mock purpose');
    }) };
    const result = await createWeeklyPlanningSemanticPipelineV5(createWeeklyPlanningSemanticNormalizerV5(client)).run({
      conversationId: 'sol7-h0560', turnId: 'duplicate', expectedRevision: 0, userText: TEXT + ' padding'.repeat(800),
      schedulerContext: { ownerId: 'sol7', currentDate: '2026-10-07', planningStartDate: '2026-10-12', planningEndDate: '2026-10-18', timeZone: 'Asia/Tokyo' } });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(3); expect(result.canonicalization?.status).toBe('applied');
    const active = new Set(result.graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
    expect(result.graph.workloads.filter(w => active.has(w.id) && w.quantityRole === 'target').reduce((n, w) => n + w.amount, 0)).toBe(20);
  });
});

it.each([false, true])('persists the actual normalization diagnostic through outbox retry and Worker (oversized=%s)', async oversized => {
  const userId = 'sol7-h0560-owner'; const conversationId = 'weekly-conversation-923e4567-e89b-52d3-a456-426614174000';
  const restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true'); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  try {
    const requests: unknown[] = [];
    const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
      requests.push(request); return JSON.stringify(document());
    } }).normalize({ userText: TEXT, traceRequestId: 'sol7-h0560-trace' });
    expect(result.status).toBe('accepted'); expect(result.document!.tasks[0].workloads).toHaveLength(1); expect(requests).toHaveLength(1);
    const debugTraceEvents = structuredClone(readWeeklyPlanningStableV5DebugTrace('sol7-h0560-trace'));
    const decision = debugTraceEvents.find(event => event.stage === 'semantic_normalizer_decision')!;
    expect(decision.data).toMatchObject({ diagnostics: { algorithmicRepairs: ['same-container-workload-duplicate-removed:task:copy'] } });
    const validation = debugTraceEvents.find(event => event.stage === 'semantic_validation_result')!;
    const actualRequest = debugTraceEvents.find(event => event.stage === 'semantic_provider_request')!;
    expect(actualRequest.data).toHaveProperty('request.messages', (requests[0] as { messages: unknown[] }).messages);
    // Existing persistent evidence is provider-before versus validated-after; normalizer bookkeeping stays local.
    const normalized = (validation.data as { parsedDocument: Record<string, unknown> }).parsedDocument;
    normalized.futureSiblingSentinel = 'future-sibling-field-retained';
    // Exceed the structured-result budget while remaining inside the existing 192KiB outbox input contract.
    if (oversized) normalized.largeSiblingValue = 'oversized-sibling'.repeat(4_000);
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = []; let first = true;
    const repository: WeeklyPlanningTraceRepository = { async upsertSession() {}, async appendEntries(input) {
      if (first) { first = false; throw new Error('injected append failure'); } writes.push(structuredClone(input));
    }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {},
      async getSession() { return null; }, async listEntries() { return []; } };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const input = { userId, conversationId, requestId: 'sol7-h0560-trace', userText: TEXT, assistantMessage: 'fixture',
      responseSource: 'ai' as const, outcome: 'discuss', previewCount: 0, debugTraceEvents };
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(writes).toHaveLength(0); expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: 'sol7-h0560-retry', debugTraceEvents: [] });
    expect(writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
    const stored = writes[0].entries[0]; expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: writes[0].session as unknown as Record<string, unknown>,
      entries: writes[0].entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '107' },
    { sessionId: 'weekly-trace-923e4567-e89b-52d3-a456-426614174000', logicalConversationId: conversationId }, '2026-10-13T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1); expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const entry of [stored, prepared.entries[0]]) {
      const serialized = JSON.stringify(entry);
      if (oversized) expect(serialized).toMatch(/traceTruncated|truncation/);
      else {
        expect(serialized).toContain('future-sibling-field-retained');
        const evidence = JSON.parse(serialized).aiInterpreter;
        expect(evidence.structuredResults[0].structuredResult.tasks[0].workloads).toEqual([workload('first')]);
        expect(JSON.parse(evidence.rawResponses[0].text).tasks[0].workloads).toHaveLength(2);
      }
    }
  } finally { restore(); }
});
