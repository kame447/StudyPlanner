import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../weeklyPlanningStableV5RuntimeSession';
import { recordWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest, takeWeeklyPlanningStableV5DebugTrace } from '../../trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../../trace/weeklyPlanningTraceTypes';
import { c5ControllerHarness, OWNER } from './controller.testUtils';

let restore: () => void;
beforeEach(() => { restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); });
afterEach(() => { setWeeklyPlanningTraceRepositoryForTests(undefined); resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); restore(); });

describe('C5 generated diagnostic through persistent retry and Worker', () => {
  it('persists the actual atomic outcome and unknown nested fields; excludes authority payloads before the outbox and bounds large values', async () => {
    const h = c5ControllerHarness(); await h.present(); await h.submit('教材aは1問7分です');
    const pending = h.actions.filter((a) => a.type === 'begin_turn').pop()!;
    if (pending.type !== 'begin_turn') throw new Error('missing actual turn');
    const requestId = pending.pending.requestId;
    const actualEvents = takeWeeklyPlanningStableV5DebugTrace(requestId);
    expect(JSON.stringify(actualEvents)).toContain('durableConsumption');
    expect(JSON.stringify(actualEvents)).toContain('"candidateCount":2');
    // Snapshot/source provenance/ledger enable mutation or contain private original text. They
    // are deliberately omitted at emission. The bounded route/count/durable outcome is the alternative.
    const emitted = JSON.stringify(actualEvents);
    for (const secret of ['private-source-', 'payloadSerialization', 'selectionKey', 'candidateSetHash', 'estimate-7']) expect(emitted).not.toContain(secret);
    const future = 'future-c5-unknown-sentinel';
    const huge = `HEAD-${'大'.repeat(80_000)}-TAIL`;
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_canonicalization_evaluated', data: {
      branch: 'c5_local_selection', result: { status: 'accepted' },
      adoptedOperations: [{ kind: 'local_candidate_selection', candidateCount: 2, durableConsumption: true,
        futureField: future, futureLargeField: huge }],
    } });
    const events = [...actualEvents, ...takeWeeklyPlanningStableV5DebugTrace(requestId)];
    const writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[] = [];
    let fail = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {}, async appendEntries(p) { if (fail) { fail = false; throw new Error('injected append'); } writes.push(structuredClone(p)); },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {},
      async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const input = { userId: OWNER, conversationId: h.conversationId, requestId, userText: '教材aは1問7分です',
      assistantMessage: '選択を反映しました。', responseSource: 'deterministic_fallback' as const,
      outcome: 'question', previewCount: 0, debugTraceEvents: events };
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(writes).toHaveLength(0);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: h.conversationId });
    expect(queued).toHaveLength(1); expect(JSON.stringify(queued)).toContain(future);
    for (const secret of ['private-source-', 'payloadSerialization', 'selectionKey', 'candidateSetHash', 'estimate-7']) expect(JSON.stringify(queued)).not.toContain(secret);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${h.conversationId}:request:3`, debugTraceEvents: [] });
    expect(writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: h.conversationId })).toEqual([]);
    const entry = writes[0].entries[0]; const raw = JSON.stringify(entry);
    expect(raw).toContain('c5_local_selection'); expect(raw).toContain('durableConsumption'); expect(raw).toContain('"candidateCount":2'); expect(raw).toContain(future);
    expect(raw).not.toContain(huge); expect(raw).toMatch(/trace truncated|truncation|traceTruncated/);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: writes[0].session as unknown as Record<string, unknown>,
      entries: writes[0].entries as unknown as Record<string, unknown>[] },
      { token: `wpt_${'f'.repeat(43)}`, epoch: '105' },
      { sessionId: 'weekly-trace-623e4567-e89b-52d3-a456-426614174000', logicalConversationId: h.conversationId }, '2026-10-05T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1); expect(JSON.stringify(prepared.entries[0])).toContain(future);
    expect(JSON.stringify(prepared.entries[0])).toContain('durableConsumption');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});
