import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyPlanningStableCollectionLimitError, findWeeklyPlanningStableCollectionLimit } from '../weeklyPlanningStateCodec';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  peekWeeklyPlanningStableV5DebugTraceForTest,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningPendingTurn } from '../types';
import {
  recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedWeeklyPlanningApplicationTurn,
  recordFailedWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnTraceSideEffectServices,
} from './weeklyPlanningTurnTraceSideEffects';

const pending: WeeklyPlanningPendingTurn = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:2',
  requestId: 'conversation-1:request:2',
  weekStartDate: '2026-07-27',
  baseRevision: 3,
  startedAt: '2026-07-24T10:00:00.000Z',
};

function createServices() {
  const graph = {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 4,
    planningWindows: [{
      id: 'window-1',
      start: '2026-07-27',
      end: '2026-08-02',
    } as never],
    tasks: [{} as never, {} as never],
    workloads: [{} as never],
    availabilityDeclarations: [{} as never],
    factLifecycles: [
      { factId: 'window-1', status: 'active' } as never,
      { factId: 'task-1', status: 'active' } as never,
      { factId: 'task-old', status: 'retracted' } as never,
    ],
  };
  return {
    getRuntimeSession: vi.fn(() => ({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph,
      updatedAt: Date.parse('2026-07-24T10:00:00.000Z'),
    })),
    recordTurnTrace: vi.fn(async () => undefined),
  } satisfies WeeklyPlanningTurnTraceSideEffectServices;
}

afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
});

describe('weeklyPlanningTurnTraceSideEffects', () => {
  it.each([false, true])('persists an admission failure through outbox retry and Worker preparation (oversized=%s)', async oversized => {
    const restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    const conversationId = 'weekly-conversation-623e4567-e89b-52d3-a456-426614174000';
    const ownerId = 'admission-trace-owner';
    const requestId = `${conversationId}:request:1`;
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let failNext = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(value) {
        if (failNext) { failNext = false; throw new Error('injected append failure'); }
        writes.push(structuredClone(value));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    try {
      const detail = findWeeklyPlanningStableCollectionLimit({ previewCandidates: 501 });
      expect(detail).toEqual({ collection: 'previewCandidates', actualCount: 501, limit: 500 });
      if (!detail) throw new Error('Expected admission rejection');
      const error = new WeeklyPlanningStableCollectionLimitError(detail);
      beginWeeklyPlanningStableV5DebugTrace(requestId);
      // Existing error projection intentionally carries only bounded type/message.
      recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'runtime_turn_threw', data: { error: {
        name: error.name, message: error.message, futureClosedErrorField: 'excluded-error-sentinel',
      } } });
      // Test-only future fields use an existing extensible diagnostic carrier. This
      // does not add an admission trace field/stage or a new production payload.
      recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_pipeline_input', data: {
        publicStateSummary: { ...detail, futureAdmissionSentinel: 'retained-admission-sentinel',
          ...(oversized ? {
            largeValue: 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2),
            secondLargeValue: 'y'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2),
          } : {}),
        },
      } });
      const input = { ownerId, pending: { ...pending, conversationId, requestId,
        turnId: `${conversationId}:turn:1` }, userText: '候補を作成してください', error,
        assistantMessage: { id: `${conversationId}:turn:1:assistant`, role: 'assistant' as const,
          content: error.message, createdAt: '2026-10-10T00:00:00Z' } };
      await recordFailedWeeklyPlanningApplicationTurn(input);
      expect(writes).toHaveLength(0);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: ownerId, conversationId })).toHaveLength(1);
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordFailedWeeklyPlanningApplicationTurn({ ...input,
        pending: { ...input.pending, requestId: `${conversationId}:request:retry` } });
      expect(writes).toHaveLength(2);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: ownerId, conversationId })).toEqual([]);
      const entry = writes[0].entries[0];
      expect(entry.kind).toBe('turn_diagnostic');
      if (entry.kind !== 'turn_diagnostic') throw new Error('Expected actual failed-turn diagnostic');
      expect(entry.diagnostics.error).toEqual({ type: error.name, message: error.message });
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain('excluded-error-sentinel');
      for (const marker of [error.name, error.message, 'retained-admission-sentinel', 'previewCandidates', '501']) {
        expect(serialized).toContain(marker);
      }
      expect(serialized).not.toContain('stable_v5_provider_failure');
      expect(serialized).not.toContain('normalization_rejected');
      if (oversized) {
        expect(entry.aiInterpreter.input.planningStateSummary).toMatchObject({ traceTruncated: true, originalBytes: expect.any(Number) });
        expect(entry.diagnostics.truncation?.applied).toBe(true);
        expect(entry.diagnostics.truncation?.fields).toContain('aiInterpreter.input.planningStateSummary');
        expect(serialized).not.toContain('x'.repeat(5000));
        expect(serialized).not.toContain('y'.repeat(5000));
      } else {
        expect(entry.aiInterpreter.input.planningStateSummary).toEqual({ ...detail, futureAdmissionSentinel: 'retained-admission-sentinel' });
      }
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: writes[0].session as unknown as Record<string, unknown>,
        entries: writes[0].entries as unknown as Record<string, unknown>[],
      }, { token: `wpt_${'a'.repeat(43)}`, epoch: '103' }, {
        sessionId: 'weekly-trace-623e4567-e89b-52d3-a456-426614174000', logicalConversationId: conversationId,
      }, '2026-10-10T00:00:00Z');
      expect(prepared.entries).toHaveLength(1);
      for (const marker of [error.name, error.message, 'retained-admission-sentinel']) {
        expect(JSON.stringify(prepared.entries[0])).toContain(marker);
      }
      expect(JSON.stringify(prepared.entries[0])).not.toContain('excluded-error-sentinel');
      if (oversized) expect(JSON.stringify(prepared.entries[0])).toContain('traceTruncated');
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    } finally {
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      restore();
    }
  });

  it('records only the committed turn fields needed by the compact trace schema', async () => {
    const services = createServices();

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: 'この条件で作成して',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'draft_ready' as const,
        },
        message: '仮予定を作成しました。',
        draftCandidates: [{} as never, {} as never],
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
      userText: 'この条件で作成して',
      assistantMessage: '仮予定を作成しました。',
      outcome: 'preview_ready',
      debugTraceEvents: [],
      previewCount: 2,
      planningRangeStart: '2026-07-27',
      planningRangeEnd: '2026-08-02',
      errorCode: undefined,
    });
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      graphSummary: expect.anything(),
      compatibilityState: expect.anything(),
    }));
  });

  it('passes ordered debug stages without copying compatibility state', async () => {
    const services = createServices();
    beginWeeklyPlanningStableV5DebugTrace(pending.requestId);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'semantic_provider_request',
      data: {
        request: { messages: [{ role: 'system', content: 'full system message' }] },
      },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'semantic_canonicalization_evaluated',
      data: {
        adoptedOperations: {
          fromRevision: 3,
          toRevision: 4,
          added: [{ kind: 'effort_estimate', id: 'effort-1' }],
        },
      },
    });

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: '3時間ぐらいかな',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'revision_pending' as const,
        },
        message: '計画期間が複数あります。',
        draftCandidates: [],
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      debugTraceEvents: [
        expect.objectContaining({ sequence: 0, stage: 'semantic_provider_request' }),
        expect.objectContaining({ sequence: 1, stage: 'semantic_canonicalization_evaluated' }),
      ],
    }));
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      compatibilityState: expect.anything(),
    }));
    expect(peekWeeklyPlanningStableV5DebugTraceForTest(pending.requestId)).toEqual([]);
  });

  it('records controlled execution failure as an error diagnostic with assistant output', async () => {
    const services = createServices();

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: '続けて',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'revision_pending' as const,
        },
        message: 'AIに接続できませんでした。',
        draftCandidates: [],
        failure: {
          code: 'stable_v5_provider_failure',
          userMessage: 'AIに接続できませんでした。',
          traceCode: 'weekly_planning_provider_failure',
          diagnostics: {
            attemptCount: 1,
            repairAttempted: false,
            validationErrorCategories: [],
            providerErrorCategory: 'provider_error',
          },
        },
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      assistantMessage: 'AIに接続できませんでした。',
      outcome: 'stable_v5_provider_failure',
      errorCode: 'weekly_planning_provider_failure',
    }));
  });

  it('records and consumes a stale discarded execution without a phantom assistant output', async () => {
    const services = createServices();
    beginWeeklyPlanningStableV5DebugTrace(pending.requestId);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'runtime_branch_selected',
      data: { branch: 'preview_ready' },
    });

    await recordDiscardedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: 'この条件で予定を作って',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'draft_ready' as const,
        },
        message: '1件の候補を作りました。',
        draftCandidates: [{} as never],
      },
      reason: 'stale',
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'discarded_stale',
      errorCode: 'stale_async_result_discarded',
      previewCount: 0,
      debugTraceEvents: [
        expect.objectContaining({ stage: 'runtime_branch_selected' }),
      ],
    }));
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      assistantMessage: expect.anything(),
      compatibilityState: expect.anything(),
    }));
    expect(peekWeeklyPlanningStableV5DebugTraceForTest(pending.requestId)).toEqual([]);
  });

  it('records failed trace with assistant output and no application state', async () => {
    const services = createServices();
    const error = new TypeError('invalid response');

    await recordFailedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: '続けて',
      error,
      assistantMessage: {
        id: 'conversation-1:turn:2:assistant',
        role: 'assistant',
        content: '更新できませんでした。',
        createdAt: '2026-07-24T10:00:01.000Z',
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed',
      debugTraceEvents: [],
      previewCount: 0,
      errorCode: 'TypeError',
      assistantMessage: '更新できませんでした。',
    }));
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      compatibilityState: expect.anything(),
    }));
  });

  it.each([false, true])('attributes failed-turn wording to AI only with a recovery receipt (verified=%s)', async (verified) => {
    const services = createServices();
    const message = '今回は反映せず、以前の候補を残しています。何を予定に入れたいですか？';
    await recordFailedWeeklyPlanningApplicationTurn({ ownerId: 'user-1', pending, userText: 'それは',
      error: new Error('semantic rejection'),
      assistantMessage: { id: 'assistant', role: 'assistant', content: message, createdAt: pending.startedAt },
      result: { state: createInitialPlanningIntakeState(), message, draftCandidates: [], responseSource: 'ai',
        ...(verified ? { recoveryPresentation: { question: null } } : {}) },
    }, services);
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      responseSource: verified ? 'ai' : 'system', assistantMessage: message, outcome: 'failed',
    }));
  });

});
