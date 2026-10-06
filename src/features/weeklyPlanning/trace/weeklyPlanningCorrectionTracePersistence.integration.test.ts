import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
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


it('persists real explicit-window correction diagnostics through failure, retry and Worker limits', async () => {
  for (const oversized of [false, true]) {
    repositoryState.failWrites = true;
    repositoryState.attempts.length = 0;
    repositoryState.successfulWrites.length = 0;
    window.localStorage.clear();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    let document: WeeklyPlanningSemanticDocumentV5 = {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan',
      planningWindow: { localId: 'old', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日の予定を立てたい' },
      tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
    };
    const pipeline = createWeeklyPlanningSemanticPipelineV5({ normalize: async () => ({ status: 'accepted', document,
      diagnostics: { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, jsonSchemaName: 'weekly_planning_semantic_document_v5',
        normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
        requestBytes: [1], responseLengths: [1], latencyMs: 1, validationErrors: [], providerError: null } }) });
    const schedulerContext = { ownerId: 'trace-user', currentDate: '2026-10-06', planningStartDate: '2026-10-06', planningEndDate: '2026-10-06', timeZone: 'Asia/Tokyo' };
    const first = await pipeline.run({ graph: createEmptyWeeklyPlanningFactGraphV5(), conversationId: canonicalIds.logicalConversationId,
      turnId: 'window-initial', expectedRevision: 0, userText: '明日の予定を立てたい', recentConversation: [], publicStateSummary: {}, schedulerContext });
    const oldId = first.canonicalization!.localToFactId.old;
    document = { ...document, planningIntent: 'update_plan', planningWindow: { ...document.planningWindow!, localId: 'new', value: 'today', sourceText: '明日じゃなくて今日だ' },
      corrections: [{ localId: 'fix', target: { kind: 'planning_window', publicId: oldId, localId: null, mention: '明日' },
        operation: 'replace', replacementLocalId: 'new', sourceText: '明日じゃなくて今日だ' }] };
    const requestId = `window-trace-${oversized ? 'large' : 'small'}`;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    const corrected = await pipeline.run({ graph: first.graph, conversationId: canonicalIds.logicalConversationId,
      turnId: requestId, expectedRevision: first.graph.revision, userText: '明日じゃなくて今日だ', recentConversation: [], publicStateSummary: {}, schedulerContext });
    expect(corrected.canonicalization?.status).toBe('applied');
    const canonical = corrected.canonicalization!;
    const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
    const event = events.find(entry => entry.stage === 'semantic_canonicalization_evaluated')!;
    expect(event).toBeDefined();
    const data = event.data as Record<string, unknown>;
    // Exceed the document budget while staying within the outbox's separate
    // 192 KiB ingress limit; overflowing that queue is intentionally rejected.
    data.adoptedOperations = { ...(data.adoptedOperations as Record<string, unknown>),
      futureWindowCorrectionSentinel: { retained: true }, ...(oversized ? { futureLargePayload: 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2) } : {}) };
    await recordWeeklyPlanningStableV5TurnTrace({ ...traceInput({ requestId, debugTraceEvents: events }),
      userText: '明日じゃなくて今日だ', assistantMessage: '予定に入れる作業を教えてください。', outcome: 'nothing_to_schedule' });
    expect(repositoryState.successfulWrites).toHaveLength(0);
    expect(window.localStorage.length).toBeGreaterThan(0);
    repositoryState.failWrites = false;
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({ requestId: `${requestId}-retry`, debugTraceEvents: [] }));
    expect(repositoryState.successfulWrites).toHaveLength(2);
    const retried = repositoryState.successfulWrites[0];
    // Retry rebuilds the observation timestamp; all original diagnostic content stays.
    const originalEntry = repositoryState.attempts[0].entries[0];
    const { observedAt: firstObservedAt, ...originalContent } = originalEntry;
    const { observedAt: retriedObservedAt, ...retriedContent } = retried.entries[0];
    expect(retriedContent).toEqual(originalContent);
    expect(Date.parse(String(retriedObservedAt))).toBeGreaterThanOrEqual(Date.parse(String(firstObservedAt)));
    const entry = retried.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite(retried, subject, canonicalIds, '2026-10-06T00:00:00Z');
    expect(prepared.entries).toHaveLength(1);
    const stored = prepared.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    const serialized = JSON.stringify(stored);
    if (oversized) {
      expect(serialized).toContain('truncation');
      expect(entry).toMatchObject({ diagnostics: { truncation: { applied: true } } });
    } else {
      expect(serialized).toContain('futureWindowCorrectionSentinel');
      expect(stored).toMatchObject({ decision: { stateDiff: {
        fromRevision: canonical.diff!.fromRevision, toRevision: canonical.diff!.toRevision,
        superseded: expect.arrayContaining([{ kind: 'planning_window', id: oldId }]),
        added: expect.arrayContaining([{ kind: 'planning_window', id: canonical.localToFactId.new }]),
        removed: expect.arrayContaining([{ kind: 'correction_intent', id: canonical.localToFactId.fix }]),
      } } });
      for (const id of [oldId, canonical.localToFactId.new, canonical.localToFactId.fix]) expect(serialized).toContain(id);
      for (const key of ['fromRevision', 'toRevision', 'superseded', 'added', 'removed']) expect(serialized).toContain(`"${key}"`);
      expect(serialized).toContain(`"fromRevision":${canonical.diff!.fromRevision}`);
      expect(serialized).toContain(`"toRevision":${canonical.diff!.toRevision}`);
    }
  }
});
