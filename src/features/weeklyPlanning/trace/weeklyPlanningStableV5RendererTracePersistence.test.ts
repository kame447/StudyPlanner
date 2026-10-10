import { recordFailedWeeklyPlanningApplicationTurn } from '../application/weeklyPlanningTurnTraceSideEffects';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { WeeklyPlanningSemanticNormalizerRunV5 } from '../semantic/weeklyPlanningSemanticNormalizerRunV5';
import { recordWeeklyPlanningStableV5FailureDiagnostics, takeWeeklyPlanningStableV5FailureDiagnostics } from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
import { beginWeeklyPlanningStableV5DebugTrace, recordWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { createAiWeeklyPlanningStableV5DialogueRenderer } from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import { boundWeeklyPlanningDialogueRendererTraceForTransport, resetWeeklyPlanningDialogueRendererPromptContextsForTest } from './weeklyPlanningDialogueRendererTrace';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { isWeeklyPlanningTraceEntry } from './weeklyPlanningTraceTypes';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../dialogue/weeklyPlanningStableV5DialogueContracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanningDialogueRendererTrace } from './weeklyPlanningDialogueRendererTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import {
  listWeeklyPlanningTraceOutboxItems,
} from './weeklyPlanningTraceOutbox';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

type PersistedRendererDiagnostic = WeeklyPlanningTraceTurnDiagnosticEntry & {
  diagnostics: WeeklyPlanningTraceTurnDiagnosticEntry['diagnostics'] & {
    dialogueRenderer?: WeeklyPlanningDialogueRendererTrace;
  };
};

function createRepositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  let failuresRemaining = 0;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('injected trace write failure');
      }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return {
    repository,
    writes,
    failNext(count = 1) {
      failuresRemaining = count;
    },
  };
}

function rendererTrace(
  status: 'rendered' | 'fallback',
): WeeklyPlanningDialogueRendererTrace {
  const fallback = status === 'fallback';
  return {
    actionId: 'stable-v5:conversation-1:request:1:quantity_role_unresolved',
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    request: {
      purpose: 'weekly_planning_renderer',
      requiredLabels: ['院試の勉強'],
      fallbackText: '今回進めたい量か、残っている全体量か教えてください。',
      previewCount: 0,
    },
    response: {
      status,
      reason: fallback ? 'provider_error' : null,
      rawResponse: fallback ? null : '{"actionId":"ok","text":"どちらの量ですか？"}',
      renderedText: fallback ? null : 'どちらの量ですか？',
    },
    decision: {
      branch: fallback ? 'deterministic_fallback' : 'ai_rendered',
      responseSource: fallback ? 'deterministic_fallback' : 'ai',
      finalMessage: fallback
        ? '今回進めたい量か、残っている全体量か教えてください。'
        : 'どちらの量ですか？',
    },
  };
}

function traceInput(overrides: Partial<Parameters<
  typeof recordWeeklyPlanningStableV5TurnTrace
>[0]> = {}) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-1',
    requestId: 'conversation-1:request:1',
    userText: '院試の勉強を進めたい',
    assistantMessage: 'どちらの量ですか？',
    responseSource: 'ai' as const,
    dialogueRendererTrace: rendererTrace('rendered'),
    outcome: 'revision_pending',
    previewCount: 0,
    debugTraceEvents: [],
    ...overrides,
  };
}

function diagnosticEntry(entries: WeeklyPlanningTraceEntry[]): PersistedRendererDiagnostic {
  const entry = entries[0];
  if (!entry || entry.kind !== 'turn_diagnostic') {
    throw new Error('expected one turn diagnostic');
  }
  return entry as PersistedRendererDiagnostic;
}

let restoreStorage: (() => void) | undefined;

describe('Stable V5 renderer trace persistence', () => {
  beforeEach(() => {
    restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restoreStorage?.();
    restoreStorage = undefined;
  });

  it('persists renderer request, raw response and final decision in the turn diagnostic', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const trace = rendererTrace('rendered');

    await recordWeeklyPlanningStableV5TurnTrace(traceInput({ dialogueRendererTrace: trace }));

    expect(harness.writes).toHaveLength(1);
    const entry = diagnosticEntry(harness.writes[0].entries);
    expect(entry.assistantOutput.responseSource).toBe('ai');
    expect(entry.diagnostics.dialogueRenderer).toEqual(trace);
    expect(entry.diagnostics.dialogueRenderer?.request?.purpose).toBe('weekly_planning_renderer');
    expect(entry.diagnostics.dialogueRenderer?.response.rawResponse).toContain('どちらの量ですか');
    expect(entry.diagnostics.dialogueRenderer?.decision).toMatchObject({
      branch: 'ai_rendered',
      responseSource: 'ai',
      finalMessage: 'どちらの量ですか？',
    });
  });

  it('keeps session and turn fallback diagnostics consistent for deterministic fallback', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      assistantMessage: '今回進めたい量か、残っている全体量か教えてください。',
      responseSource: 'deterministic_fallback',
      dialogueRendererTrace: rendererTrace('fallback'),
    }));

    expect(harness.writes[0].session.hasFallback).toBe(true);
    const entry = diagnosticEntry(harness.writes[0].entries);
    expect(entry.assistantOutput.responseSource).toBe('deterministic_fallback');
    expect(entry.diagnostics.fallback).toBe('provider_error');
    expect(entry.diagnostics.dialogueRenderer?.response).toMatchObject({
      status: 'fallback',
      reason: 'provider_error',
    });
  });

  it('preserves attempted renderer diagnostics for a stale turn without assistant output', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const trace = rendererTrace('rendered');

    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      assistantMessage: undefined,
      responseSource: 'system',
      dialogueRendererTrace: trace,
      outcome: 'discarded_stale',
      errorCode: 'stale_async_result_discarded',
    }));

    expect(harness.writes[0].session.hasError).toBe(true);
    const entry = diagnosticEntry(harness.writes[0].entries);
    expect(entry.assistantOutput).toEqual({
      text: null,
      responseSource: 'system',
    });
    expect(entry.diagnostics.stale).toBe(true);
    expect(entry.diagnostics.dialogueRenderer?.decision).toMatchObject({
      branch: 'ai_rendered',
      responseSource: 'ai',
    });
  });

  it('preserves renderer details when a failed write is replayed from the persistent outbox', async () => {
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput();

    await recordWeeklyPlanningStableV5TurnTrace(first);
    expect(harness.writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: first.userId,
      conversationId: first.conversationId,
    })[0]?.input.dialogueRendererTrace).toEqual(first.dialogueRendererTrace);

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      requestId: 'conversation-1:request:2',
      userText: '次の入力',
    }));

    expect(harness.writes).toHaveLength(2);
    const replayed = diagnosticEntry(harness.writes[0].entries);
    expect(replayed.requestId).toBe(first.requestId);
    expect(replayed.diagnostics.dialogueRenderer).toEqual(first.dialogueRendererTrace);
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: first.userId,
      conversationId: first.conversationId,
    })).toEqual([]);
  });

  it.each([false, true])('persists actual recovery generation/verifier requests through retry and Worker (large=%s)', async (large) => {
    const calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const input: WeeklyPlanningStableV5DialogueRenderInput = {
      actionId: 'stable-v5:recovery-trace:missing_schedulable_work', currentUserMessage: 'それは',
      recentConversation: [], planningInformation: null, actionKind: 'question',
      questionCode: 'missing_schedulable_work', questionTarget: null,
      questionIntent: { kind: 'schedulable_work_detail', mode: 'missing_task_identity', targetFactId: null,
        progressBasis: null, knownUnitCode: null, knownUnitLabel: null, requestedInformation: ['task_identity'] },
      requiredLabels: [], fallbackText: '', previewCount: 0,
      recoveryQuestionEvidence: { facts: [], labels: [] },
      recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true, retainedPreviewUnchanged: true },
    };
    const text = '今回はまだ反映していません。以前の候補はそのままです。何を予定に入れたいですか？';
    const raw = JSON.stringify({ actionId: input.actionId, actionKind: 'question',
      questionCode: input.questionCode, groundingAcknowledgement: null, text });
    const checkRaw = JSON.stringify({ actionId: input.actionId, questionMatches: 'yes',
      planningDetailsNotApplied: 'yes', acceptedStateUnchanged: 'yes',
      retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' });
    const result = await createAiWeeklyPlanningStableV5DialogueRenderer(
      { provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' },
      { async createChatCompletion(request) { calls.push(request); return calls.length === 1 ? raw : checkRaw; } },
      { canDispatchRecovery: () => true },
    ).render(input);
    expect(result).toMatchObject({ status: 'rendered', recoveryVerified: true });
    expect(calls).toHaveLength(2);
    const trace = boundWeeklyPlanningDialogueRendererTraceForTransport({
      ...rendererTrace('rendered'), actionId: input.actionId, questionCode: input.questionCode,
      response: { status: 'rendered', reason: null, rawResponse: raw, renderedText: text },
      decision: { branch: 'ai_rendered', responseSource: 'ai', finalMessage: text },
    });
    const context = trace.request!.promptContext as Record<string, unknown>;
    expect(context.messages).toEqual(calls[0].messages);
    expect((context.recoveryVerification as Record<string, unknown>).messages).toEqual(calls[1].messages);
    expect((context.recoveryVerification as Record<string, unknown>).rawResponse).toBe(checkRaw);
    trace.request!.promptContext = { futureRecoverySentinel: { retained: true }, ...context,
      ...(large ? { largeFutureRecoveryValue: 'large-recovery-data'.repeat(30_000) } : {}) };
    const requestId = 'recovery-trace-request';
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    const run = new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => '{' },
      { userText: 'それは', traceRequestId: requestId });
    await run.callGeneric([], 'initial');
    recordWeeklyPlanningStableV5FailureDiagnostics({ turnId: requestId, status: 'normalization_rejected',
      diagnostics: run.diagnostics({ attemptCount: 1, repairAttempted: false,
        validationErrors: ['document:invalid-json'], providerError: null }) });
    const failure = takeWeeklyPlanningStableV5FailureDiagnostics(requestId);
    expect(failure?.providerDispatch).toEqual({ count: 1, anyFailure: false, complete: true });
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'turn_executor_result_projected',
      data: { branch: 'recorded_failure_projected', recordedFailure: { ...failure,
        providerDispatch: { ...failure?.providerDispatch, privateFutureMetadata: 'omit-private-dispatch-sentinel' } },
      projectedResult: {} } });

    const harness = createRepositoryHarness(); harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput({ requestId, dialogueRendererTrace: trace, assistantMessage: text });
    await recordFailedWeeklyPlanningApplicationTurn({ ownerId: first.userId,
      pending: { requestId, conversationId: first.conversationId, turnId: 'recovery-turn',
        weekStartDate: '2026-10-05', baseRevision: 1, startedAt: '2026-10-10T00:00:00.000Z' },
      userText: first.userText, error: new Error('semantic rejection'),
      assistantMessage: { id: 'recovery-assistant', role: 'assistant', content: text, createdAt: '2026-10-10T00:00:01.000Z' },
      result: { state: createInitialPlanningIntakeState(), message: text, draftCandidates: [],
        responseSource: 'ai', recoveryPresentation: { question: null }, dialogueRendererTrace: trace },
    }, { getRuntimeSession: () => null, recordTurnTrace: recordWeeklyPlanningStableV5TurnTrace });
    expect(harness.writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: first.userId, conversationId: first.conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({ requestId: 'recovery-trace-retry' }));
    expect(harness.writes).toHaveLength(2);
    const retried = harness.writes[0];
    expect(diagnosticEntry(retried.entries).assistantOutput.responseSource).toBe('ai');
    const serialized = JSON.stringify(retried.entries[0]);
    expect(serialized).toContain('futureRecoverySentinel');
    expect(serialized).toContain('providerDispatch');
    expect(diagnosticEntry(retried.entries).diagnostics.providerDispatch).toEqual({
      count: 1, anyFailure: false, complete: true });
    expect(serialized).not.toContain('omit-private-dispatch-sentinel');
    if (large) expect(serialized).toContain('traceTruncated');
    else {
      expect(serialized).toContain('recoveryVerification');
      expect(serialized).toContain('planningDetailsNotApplied');
      expect(serialized).toContain('questionMatches');
    }
    expect(measureWeeklyPlanningTraceJsonBytes(retried.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const subject = { token: `wpt_${'a'.repeat(43)}`, epoch: '100' };
    const canonicalIds = {
      sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000',
      logicalConversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
    };
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: retried.session as unknown as Record<string, unknown>,
      entries: retried.entries as unknown as Record<string, unknown>[],
    }, subject, canonicalIds, '2026-10-10T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain('futureRecoverySentinel');
    expect(JSON.stringify(prepared.entries[0])).not.toContain('omit-private-dispatch-sentinel');
    expect((prepared.entries[0].diagnostics as Record<string, unknown>).providerDispatch).toEqual({
      count: 1, anyFailure: false, complete: true });
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    const legacy = structuredClone(diagnosticEntry(retried.entries));
    delete legacy.diagnostics.providerDispatch;
    expect(isWeeklyPlanningTraceEntry(legacy)).toBe(true);
    const legacyPrepared = prepareWeeklyPlanningTraceServerWrite({
      session: retried.session as unknown as Record<string, unknown>,
      entries: [legacy as unknown as Record<string, unknown>],
    }, subject, canonicalIds, '2026-10-10T00:00:00.000Z');
    expect(legacyPrepared.entries).toHaveLength(1);
    expect(legacyPrepared.entries[0].diagnostics).not.toHaveProperty('providerDispatch');
  });

  it.each([undefined, { count: -1, anyFailure: false, complete: true },
    { count: 1, anyFailure: 'unknown', complete: true }, { count: 1, anyFailure: false }])(
    'omits unknown or malformed provider dispatch metadata (%j)', async (providerDispatch) => {
      const harness = createRepositoryHarness(); setWeeklyPlanningTraceRepositoryForTests(harness.repository);
      await recordWeeklyPlanningStableV5TurnTrace(traceInput({ debugTraceEvents: [{
        schemaVersion: 2, sequence: 0, stage: 'turn_executor_result_projected', severity: 'error',
        occurredAt: '2026-10-10T00:00:00.000Z',
        data: { recordedFailure: { providerDispatch } },
      }] }));
      expect(diagnosticEntry(harness.writes[0].entries).diagnostics).not.toHaveProperty('providerDispatch');
    });

});
