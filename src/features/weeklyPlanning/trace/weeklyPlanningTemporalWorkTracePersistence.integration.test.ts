import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { beginWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';

// Issue #870 changed the semantic prompt, the hard-window normalization and the
// scheduler's split fallback. Each must survive the real trace persistence path.
const USER = 'temporal-work-trace-owner';
const CONVERSATION = 'weekly-conversation-a23e4567-e89b-52d3-a456-426614174000';
const SENTINEL = 'future-temporal-work-detail';
const TEXT = '明日は13時40分から16時20分まで埋まっています。明日の13〜17時の間に1時間数学をしたい';
// The new temporal instruction must be part of the actual provider request.
const INSTRUCTION_EVIDENCE = 'must-fit clock ranges for work are hard';
const REPAIR_EVIDENCE = 'preferred-window-hard-clock-bounds-canonicalized';

function providerDocument() {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日' },
    tasks: [{ localId: 'math', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
      workloads: [{ localId: 'math-amount', quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '1時間' }],
      effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: TEXT,
      // The hard window as a provider may send it; it must stay hard.
      temporalConstraints: [{ localId: 'math-window', targetLocalId: 'math', kind: 'preferred_window', constraintLevel: 'hard',
        dateExpression: 'tomorrow', namedTimePeriod: null, startTime: '13:00', endTime: '17:00', precision: 'exact', sourceText: '13〜17時の間に' }] }],
    relations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [],
    availabilityDeclarations: [{ localId: 'busy', kind: 'unavailable', dateExpression: 'tomorrow', namedTimePeriod: null,
      startTime: '13:40', endTime: '16:20', recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null,
      sourceText: '13時40分から16時20分まで埋まっています' }] };
}

let restoreStorage: (() => void) | undefined;
beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in temporal-work trace gate'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined); restoreStorage?.();
});

it('persists the actual prompt, hard-window repair and split placement through retry, Worker, future fields and byte limits', async () => {
  const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  const requestId = 'temporal-work-window';
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  const schedulerContext = { ownerId: USER, currentDate: '2026-10-26', planningStartDate: '2026-10-26',
    planningEndDate: '2026-11-01', timeZone: 'Asia/Tokyo' };
  const result = await createWeeklyPlanningSemanticPipelineV5(createWeeklyPlanningSemanticNormalizerV5({
    async createChatCompletion(request) { requests.push(request); return JSON.stringify(providerDocument()); },
  })).run({ conversationId: CONVERSATION, turnId: requestId, expectedRevision: 0, userText: TEXT, schedulerContext, traceRequestId: requestId });
  expect(result.normalization.status, JSON.stringify(result.normalization.diagnostics)).toBe('accepted');
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0].messages)).toContain(INSTRUCTION_EVIDENCE);
  expect(result.normalization.diagnostics.algorithmicRepairs).toContain(`${REPAIR_EVIDENCE}:0:0`);
  expect(result.graph.temporalConstraints.map(c => [c.kind, c.constraintLevel, c.startTime, c.endTime]))
    .toEqual(expect.arrayContaining([['earliest_start', 'hard', '13:00', null], ['latest_end', 'hard', null, '17:00']]));
  expect(result.scheduler?.status, JSON.stringify(result.scheduler?.issues)).toBe('ready');

  const preview = scheduleWeeklyPlanningStableV5Preview({ input: result.scheduler!.input!,
    graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph)) });
  // The hour stays inside the hard window and uses both 30-minute gaps.
  expect(preview.status).toBe('ready');
  const placed = preview.candidates.map(c => [c.date, c.startTime, c.endTime]);
  expect(placed).toHaveLength(2);
  for (const [date, start, end] of placed) {
    expect(date).toBe('2026-10-27');
    expect(start >= '13:00' && end <= '17:00').toBe(true);
  }
  const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
  expect(JSON.stringify(events.find(event => event.stage === 'semantic_provider_request')?.data)).toContain(INSTRUCTION_EVIDENCE);
  expect(JSON.stringify(events.find(event => event.stage === 'semantic_normalizer_decision')?.data)).toContain(REPAIR_EVIDENCE);
  const schedulerEvent = { schemaVersion: 2 as const, sequence: events.length, stage: 'runtime_preview_scheduler_evaluated',
    occurredAt: '2026-10-26T08:00:00.000Z', severity: 'info' as const,
    data: { schedulerVersion: preview.schedulerVersion, result: { ...preview,
      candidates: preview.candidates.map((candidate, index) => index === 0 ? { ...candidate, futureTemporalWorkDetail: SENTINEL } : candidate) } } };
  const debugTraceEvents = [...events, schedulerEvent];

  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let firstWrite = true;
  const repository: WeeklyPlanningTraceRepository = { async upsertSession() {}, async appendEntries(params) {
    if (firstWrite) { firstWrite = false; throw new Error('injected temporal-work trace append failure'); }
    writes.push(structuredClone(params));
  }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; } };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  const base = { userId: USER, conversationId: CONVERSATION, requestId, userText: TEXT, assistantMessage: '2件の候補を用意しました。',
    responseSource: 'ai' as const, outcome: 'scheduler_ready', previewCount: placed.length, debugTraceEvents };
  await recordWeeklyPlanningStableV5TurnTrace(base);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace({ ...base, requestId: `${requestId}-retry`, debugTraceEvents: [] });
  expect(writes).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);

  const large = structuredClone(base);
  large.requestId = `${requestId}-large`;
  (large.debugTraceEvents[large.debugTraceEvents.length - 1].data as { result: { candidates: Record<string, unknown>[] } }).result.candidates[1].futureLargeDetail = 'あ'.repeat(30_000);
  await recordWeeklyPlanningStableV5TurnTrace(large);
  expect(writes).toHaveLength(3);
  for (const [index, write] of [writes[0], writes[2]].entries()) {
    expect(write.entries).toHaveLength(1);
    const entry = write.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>, entries: write.entries as unknown as Record<string, unknown>[] },
      { token: `wpt_${'e'.repeat(43)}`, epoch: '106' }, { sessionId: 'weekly-trace-a23e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-10-26T08:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const value of [entry, prepared.entries[0]]) {
      const serialized = JSON.stringify(value);
      if (index === 0) {
        // The finite diagnostic projection keeps no normalizer repair-code list (for any repair) and an
        // explicit 1500B system-prompt prefix. The repair is evidenced by the raw hard window next to the
        // accepted hard pair; the actual request is evidenced by its full byte count.
        for (const evidence of [SENTINEL, placed[0][1], placed[1][1], '\\"kind\\":\\"preferred_window\\",\\"constraintLevel\\":\\"hard\\"',
          '"kind":"earliest_start","constraintLevel":"hard"', '"kind":"latest_end","constraintLevel":"hard"', '…[trace truncated]']) expect(serialized).toContain(evidence);
        expect(serialized).toContain(`"requestBytes":${measureWeeklyPlanningTraceJsonBytes(requests[0])}`);
      } else {
        expect(serialized).toMatch(/traceTruncated|truncation/);
        expect(serialized).not.toContain('あ'.repeat(30_000));
      }
    }
  }
});
