import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
  type WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { createWeeklyPlanningTurnDiagnosticV2 } from './weeklyPlanningTurnDiagnosticV2';

const repositoryState = vi.hoisted(() => ({
  failWrites: true,
  attempts: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }>,
  successfulWrites: [] as Array<{
    session: Record<string, unknown>;
    entries: Record<string, unknown>[];
  }>,
}));

vi.mock('./weeklyPlanningTraceRepository', () => ({
  isWeeklyPlanningTraceEnabled: () => true,
  getWeeklyPlanningTraceRepository: () => ({
    async appendEntries(params: {
      session: Record<string, unknown>;
      entries: Record<string, unknown>[];
    }) {
      repositoryState.attempts.push(structuredClone(params));
      if (repositoryState.failWrites) throw new Error('intentional trace write failure');
      repositoryState.successfulWrites.push(structuredClone(params));
    },
  }),
}));

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

function correctionTrace(requestId: string): WeeklyPlanningStableV5DebugTraceEvent[] {
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'canonical_correction_application_evaluated',
    data: {
      inputCanonicalization: {
        graph: { secretGraphPayload: 'must-not-be-persisted', facts: 'x'.repeat(40_000) },
      },
      application: { status: 'applied' },
      resultingCanonicalization: {
        graph: { secretGraphPayload: 'must-not-be-persisted' },
      },
    },
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'semantic_canonicalization_evaluated',
    data: {
      branch: 'semantic_canonicalizer',
      result: { status: 'applied' },
      adoptedOperations: {
        fromRevision: 3,
        toRevision: 5,
        superseded: [{ kind: 'workload', id: 'workload-old' }],
        added: [{ kind: 'workload', id: 'workload-new' }],
        removed: [{ kind: 'correction_intent', id: 'correction-1' }],
        futureCorrectionSentinel: { retained: true },
      },
      localReferenceResolution: {
        replacement: 'workload-new',
      },
      rejectionErrors: [],
    },
  });
  return takeWeeklyPlanningStableV5DebugTrace(requestId);
}

function traceInput(params: {
  requestId: string;
  debugTraceEvents: WeeklyPlanningStableV5DebugTraceEvent[];
}) {
  return {
    userId: 'trace-user',
    conversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
    requestId: params.requestId,
    userText: '数学は3時間ではなく1時間にしてください',
    assistantMessage: '数学の時間を1時間に変更しました。',
    responseSource: 'ai' as const,
    outcome: 'scheduler_ready',
    debugTraceEvents: params.debugTraceEvents,
    previewCount: 0,
  };
}

const subject = {
  token: `wpt_${'a'.repeat(43)}`,
  epoch: '100',
};
const canonicalIds = {
  sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000',
  logicalConversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
};

beforeEach(() => {
  repositoryState.failWrites = true;
  repositoryState.attempts.length = 0;
  repositoryState.successfulWrites.length = 0;
  vi.stubGlobal('window', { localStorage: createStorage() });
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});

afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  vi.unstubAllGlobals();
});

describe('weekly planning correction trace persistence gate', () => {
  it('queues a failed correction diagnostic, retries it, and passes Worker preparation', async () => {
    const firstRequestId = 'weekly-correction-trace-request-1';
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      requestId: firstRequestId,
      debugTraceEvents: correctionTrace(firstRequestId),
    }));
    expect(repositoryState.attempts).toHaveLength(1);
    expect(repositoryState.successfulWrites).toHaveLength(0);

    repositoryState.failWrites = false;
    const secondRequestId = 'weekly-correction-trace-request-2';
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      requestId: secondRequestId,
      debugTraceEvents: correctionTrace(secondRequestId),
    }));

    expect(repositoryState.successfulWrites).toHaveLength(2);
    const retried = repositoryState.successfulWrites[0];
    const retriedEntry = retried.entries[0];
    const serialized = JSON.stringify(retriedEntry);
    expect(serialized).not.toContain('must-not-be-persisted');
    expect(serialized).toContain('futureCorrectionSentinel');
    expect(serialized).toContain('workload-old');
    expect(measureWeeklyPlanningTraceJsonBytes(retriedEntry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: retried.session,
      entries: retried.entries,
    }, subject, canonicalIds, '2026-08-01T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain('futureCorrectionSentinel');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('keeps a large correction turn savable with explicit truncation metadata', () => {
    const hugeDiff = Array.from({ length: 400 }, (_, index) => ({
      kind: 'workload',
      id: `workload-${index}`,
      details: 'x'.repeat(1_000),
    }));
    const diagnostic = createWeeklyPlanningTurnDiagnosticV2({
      id: `${canonicalIds.sessionId}-00000000`,
      sessionId: canonicalIds.sessionId,
      logicalConversationId: canonicalIds.logicalConversationId,
      sequence: 0,
      turnIndex: 0,
      requestId: 'large-correction-request',
      occurredAt: '2026-08-01T00:00:00.000Z',
      observedAt: '2026-08-01T00:00:00.000Z',
      expireAt: '2026-11-01T00:00:00.000Z',
      userText: '大量の訂正を確認するテスト',
      assistantMessage: '訂正内容を確認しました。',
      outcome: 'scheduler_ready',
      previewCount: 0,
      debugTraceEvents: [{
        schemaVersion: 2,
        sequence: 0,
        stage: 'semantic_canonicalization_evaluated',
        occurredAt: '2026-08-01T00:00:00.000Z',
        severity: 'info',
        data: {
          branch: 'semantic_canonicalizer',
          result: { status: 'applied' },
          adoptedOperations: {
            superseded: hugeDiff,
            added: hugeDiff,
            removed: hugeDiff,
          },
          localReferenceResolution: {},
          rejectionErrors: [],
        },
      }],
    });

    expect(diagnostic.diagnostics.truncation?.applied).toBe(true);
    expect(measureWeeklyPlanningTraceJsonBytes(diagnostic)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: {
        id: canonicalIds.sessionId,
        logicalConversationId: canonicalIds.logicalConversationId,
        userId: 'trace-user',
        status: 'active',
        startedAt: '2026-08-01T00:00:00.000Z',
        lastActivityAt: '2026-08-01T00:00:00.000Z',
        turnCount: 1,
        entryCount: 1,
        hasPreview: false,
        hasApprovalFailure: false,
        hasFallback: false,
        hasError: false,
        appVersion: '0.1.0',
        schemaVersion: 2,
        expireAt: '2026-11-01T00:00:00.000Z',
      },
      entries: [diagnostic as unknown as Record<string, unknown>],
    }, subject, canonicalIds, '2026-08-01T00:00:00.000Z');

    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});
