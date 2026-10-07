import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { campaignPayload, campaignRendererReply, type CampaignRequest } from './testUtils/weeklyPlanningRealE2ECampaignFixture';
import { schedulingDocument } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { setWeeklyPlanningTraceRepositoryForTests } from './trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './trace/weeklyPlanningTraceOutbox';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './trace/weeklyPlanningStableV5TraceRuntime';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './trace/weeklyPlanningTraceTypes';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

vi.setConfig({ testTimeout: 30_000 });
type Json = Record<string, unknown>;
const TEXT = '来週、アルゴリズムイントロダクションを20ページ読みたい。1ページ3分くらい。10月17日から18日に入れたい';
const CONVERSATION = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174048';
const canonicalIds = { sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174048', logicalConversationId: CONVERSATION };
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
beforeEach(() => {
  resetScriptedConversationRuntime();
  let semanticCalls = 0;
  provider = installScriptedWeeklyPlanningProvider(call => {
    const request = call.request as unknown as CampaignRequest;
    if (call.kind === 'renderer') return campaignRendererReply(campaignPayload(request));
    semanticCalls += 1;
    const document = schedulingDocument('A', { availabilityDeclarations: [] });
    const entry = (document.tasks as Json[])[0];
    // Emulate a provider following the range format actually sent in its repair instruction.
    const directive = call.messages.at(-1)?.content ?? '';
    const slash = semanticCalls > 1 && directive.includes('YYYY-MM-DD/YYYY-MM-DD');
    entry.temporalConstraints = [{ localId: 'range', targetLocalId: 'book', kind: 'preferred_window', constraintLevel: 'soft',
      dateExpression: slash ? '2026-10-17/2026-10-18' : '2026-10-17..2026-10-18', namedTimePeriod: null,
      startTime: null, endTime: null, precision: 'exact', sourceText: '10月17日から18日に入れたい' }];
    if (!call.schemaProperties.includes('conversationActs')) delete document.conversationActs;
    return JSON.stringify(document);
  });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); });

describe('canonical range repair uses the same slash syntax as the validator', () => {
  it.each(['interaction_v1', 'legacy_v5'] as const)('runs a real initial rejection and one repair (%s)', async architecture => {
    const conversation = createScriptedConversation({ provider, architecture });
    const turn = await conversation.submit(TEXT);
    expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'semantic_generic', ...(architecture === 'interaction_v1' ? ['renderer'] : [])]);
    const repair = turn.calls[1].messages.at(-1)!.content;
    if (architecture === 'legacy_v5') {
      expect(repair).toContain('YYYY-MM-DD..YYYY-MM-DD');
      expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
      expect(conversation.getState().previewCandidates ?? []).toEqual([]);
    } else {
      expect(repair).toContain('YYYY-MM-DD/YYYY-MM-DD');
      expect(turn.result?.failure).toBeUndefined();
      expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
      expect(turn.result?.draftCandidates.every(entry => ['2026-10-17', '2026-10-18'].includes(entry.date))).toBe(true);
      expect(turn.debugTrace.find(event => event.stage === 'semantic_validation_result' && (event.data as Json).attempt === 'repair')?.data)
        .toMatchObject({ accepted: true, errors: [] });
    }
  });

  it('persists the actual repair request through outbox failure/reload, Worker preparation, future fields and bounded large values', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', conversationId: CONVERSATION });
    const turn = await conversation.submit(TEXT);
    expect(turn.result?.failure).toBeUndefined();
    const sent = turn.calls[1];
    const repairRequest = turn.debugTrace.find(event => event.stage === 'semantic_provider_request' &&
      JSON.stringify((event.data as Json).request).includes('YYYY-MM-DD/YYYY-MM-DD'))!;
    expect(((repairRequest.data as Json).request as Json).messages).toEqual(sent.messages);

    const storage = createMemoryStorageHarness();
    const restore = installWeeklyPlanningTestStorage(storage.storage);
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    const attempts: typeof writes = [];
    let fail = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {}, async appendEntries(params) {
        attempts.push(structuredClone(params));
        if (fail) throw new Error('injected date-range repair trace failure');
        writes.push(structuredClone(params));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    try {
      for (const oversized of [false, true]) {
        storage.storage.clear();
        resetWeeklyPlanningStableV5TraceRuntimeForTest();
        setWeeklyPlanningTraceRepositoryForTests(repository);
        writes.length = 0; attempts.length = 0; fail = true;
        const events = structuredClone(turn.debugTrace);
        const validation = events.find(event => event.stage === 'semantic_validation_result' && (event.data as Json).attempt === 'repair')!;
        const document = (validation.data as Json).parsedDocument as Json;
        (document.tasks as Json[])[0].futureRangeSentinel = 'future-range-repair-field';
        if (oversized) document.futureLargeField = 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2);
        const input = { userId: conversation.ownerId, conversationId: CONVERSATION, requestId: turn.requestId!, userText: TEXT,
          assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, outcome: 'draft_created',
          debugTraceEvents: events, previewCount: turn.result!.draftCandidates.length };
        await recordWeeklyPlanningStableV5TurnTrace(input);
        expect(writes).toHaveLength(0);
        const queued = listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId: CONVERSATION });
        expect(queued).toHaveLength(1);
        expect(queued[0].input.debugTraceEvents).toEqual(events);
        const queuedEntry = attempts[0].entries[0];
        resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
        fail = false;
        await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${input.requestId}-retry`, debugTraceEvents: [] });
        expect(writes).toHaveLength(2);
        expect(listWeeklyPlanningTraceOutboxItems({ userId: conversation.ownerId, conversationId: CONVERSATION })).toEqual([]);
        const entry = writes[0].entries[0];
        const { observedAt: _queuedAt, ...before } = queuedEntry;
        const { observedAt: _writtenAt, ...after } = entry;
        expect(after).toEqual(before);
        expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        const prepared = prepareWeeklyPlanningTraceServerWrite({ session: writes[0].session as unknown as Json,
          entries: writes[0].entries as unknown as Json[] }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, canonicalIds, '2026-10-07T00:00:00.000Z');
        expect(prepared.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        const serialized = JSON.stringify(prepared.entries[0]);
        if (oversized) expect(serialized).toContain('truncation');
        else {
          expect(serialized).toContain('future-range-repair-field');
          expect(serialized).toContain('YYYY-MM-DD/YYYY-MM-DD');
          expect(serialized).toContain('2026-10-17/2026-10-18');
        }
      }
    } finally { restore(); }
  });
});
