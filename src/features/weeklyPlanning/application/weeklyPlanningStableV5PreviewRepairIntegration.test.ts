import type { MonthEvent } from '../../../types/domain';
import { renderWeeklyPlanningStableV5AssistantMessage } from '../dialogue/weeklyPlanningStableV5TurnDialogue';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from '../trace/weeklyPlanningDialogueRendererTrace';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { createRemoteWeeklyPlanningTraceRepository } from '../trace/weeklyPlanningTraceRemoteRepository';
import type { WeeklyPlanningTraceApiClient, WeeklyPlanningTraceAppendInput } from '../trace/weeklyPlanningTracePrivacyClient';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeExecutor';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock, rendererClientMock } = vi.hoisted(() => ({ normalizeMock: vi.fn(), rendererClientMock: vi.fn() }));

function acceptedResult(document: WeeklyPlanningSemanticDocumentV5) {
  return {
    status: 'accepted' as const,
    document,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5' as const,
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5' as const,
      attemptCount: 1,
      repairAttempted: false,
      requestBytes: [100],
      responseLengths: [100],
      latencyMs: 1,
      validationErrors: [],
      algorithmicRepairs: [],
      providerError: null,
    },
  };
}

function initialPreviewDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window',
      kind: 'absolute',
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
      sourceText: '8月17日から23日',
    },
    tasks: [{
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: { purpose: 'homework', contextLabel: '数学', components: [] },
      workloads: [{
        localId: 'workload-math',
        quantityRole: 'target',
        amount: 30,
        unitCode: 'page',
        unitLabel: 'ページ',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学30ページ',
      }],
      effortEstimates: [{
        localId: 'effort-math',
        targetLocalId: 'workload-math',
        kind: 'duration_per_unit',
        minutes: 5,
        unitCode: 'page',
        precision: 'approximate',
        sourceText: '1ページ5分くらい',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学30ページ。1ページ5分くらい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function addedTaskMissingEffortDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-english',
      category: 'study',
      title: '英単語',
      study: { purpose: 'self_study', contextLabel: '英単語', components: [] },
      workloads: [{
        localId: 'workload-english',
        quantityRole: 'target',
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '英単語80語',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英単語80語も追加',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function incompatiblePendingReplyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({
    provider: 'openai',
    baseUrl: 'https://example.invalid/v1',
    model: 'test-model',
    apiKey: 'test-key',
  }),
  getAiConfigValidationMessage: () => undefined,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({ createChatCompletion: rendererClientMock }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));

import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';

const requestContext = {
  startedAtIso: '2026-08-11T05:55:00.000Z',
  timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-11',
  currentTime: '14:55',
  notBeforeDate: '2026-08-11',
  notBeforeTime: '14:55',
  weekStartsOn: 'monday' as const,
};

function turnInput(
  overrides: Pick<
    ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
    'userText' | 'traceRequestId' | 'previousState'
  >,
): ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  return {
    messages: [],
    selectedDate: '2026-08-17',
    userId: 'owner-preview-repair',
    plans: [],
    scheduleTemplates: [],
    conversationId: 'conversation-preview-repair',
    requestContext,
    ...overrides,
  };
}

function existingEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return { id: 'existing-event-grounding', userId: 'owner-preview-repair', date: '2026-08-21',
    title: 'Existing appointment', startTime: '19:00', endTime: '20:00', repeat: 'none', repeatUntil: null,
    excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
    createdAt: requestContext.startedAtIso, updatedAt: requestContext.startedAtIso, ...overrides };
}
function existingSourceDocument(): WeeklyPlanningSemanticDocumentV5 {
  const document = initialPreviewDocument();
  document.constraintSourceRequests = [{ localId: 'existing-source', kind: 'existing_plans',
    selector: 'active', requestedAction: 'use', sourceText: '既存予定' }];
  return document;
}

describe('Stable V5 repair-safe preview integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
    rendererClientMock.mockReset();
  });

  it('keeps the previous preview visible but non-promotable across unresolved repair turns', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(initialPreviewDocument()));
    const initial = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      userText: '8月17日から23日で数学30ページ。1ページ5分くらいで予定を作って',
      traceRequestId: 'request-preview-repair-1',
    }));

    expect(initial.draftCandidates.length).toBeGreaterThan(0);
    expect(initial.state.status).toBe('draft_ready');

    normalizeMock.mockResolvedValueOnce(acceptedResult(addedTaskMissingEffortDocument()));
    const repair = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      previousState: initial.state,
      userText: '英単語80語も追加したい',
      traceRequestId: 'request-preview-repair-2',
    }));

    expect(repair.draftCandidates).toEqual([]);
    expect(repair.preserveExistingPreview).toBe(true);
    expect(repair.state.status).toBe('revision_pending');
    expect(repair.state.shouldCreateDraft).toBe(false);
    expect(repair.state.draftGenerationIntent).toBe('user_authorized');
    expect(repair.state.questions.length).toBe(1);

    normalizeMock.mockResolvedValueOnce(acceptedResult(incompatiblePendingReplyDocument()));
    const stillRepairing = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      previousState: repair.state,
      userText: 'ちょっと待って',
      traceRequestId: 'request-preview-repair-3',
    }));

    expect(stillRepairing.draftCandidates).toEqual([]);
    expect(stillRepairing.preserveExistingPreview).toBe(true);
    expect(stillRepairing.state.status).toBe('revision_pending');
    expect(stillRepairing.state.shouldCreateDraft).toBe(false);
  });
  it.each(['empty', 'unselected', 'foreign', 'invalid'] as const)(
    'does not invent acquired existing-schedule evidence for %s input', async mode => {
      const document = existingSourceDocument();
      if (mode === 'unselected') document.constraintSourceRequests[0].requestedAction = 'stop_using';
      const userText = '8月17日から23日で数学30ページ。1ページ5分くらい。既存予定';
      const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: userText });
      expect(validation.errors).toEqual([]);
      normalizeMock.mockResolvedValueOnce(acceptedResult(validation.document!));
      const monthEvents = mode === 'empty' ? [] : [existingEvent(mode === 'foreign'
        ? { userId: 'foreign-owner' } : mode === 'invalid' ? { startTime: '25:00' } : {})];
      const result = await executeWeeklyPlanningStableV5RuntimeTurn({
        ...turnInput({ userText, traceRequestId: `request-grounding-${mode}` }), monthEvents,
      });
      expect(result.existingScheduleGrounding).toBeUndefined();
      expect(result.state).not.toHaveProperty('existingScheduleGrounding');
    },
  );

  it.each([
    '保存済みの予定と重ならない候補を作成しました。',
    '計画案を作成しました。保存はまだ行いません。',
  ])('persists actual hard-clock runtime diagnostics through outbox retry and Worker preparation: %s', async claim => {
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    const conversationId = 'weekly-conversation-733e4567-e89b-42d3-a456-426614174010';
    const userId = 'owner-preview-repair';
    const restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    const canonicalIds = {
      sessionId: 'weekly-trace-733e4567-e89b-42d3-a456-426614174010', logicalConversationId: conversationId,
    };
    const writes: WeeklyPlanningTraceAppendInput[] = [];
    // The remote repository retries transient append once before the durable outbox owns it.
    let failuresRemaining = 2;
    const api: WeeklyPlanningTraceApiClient = {
      async getPolicyStatus() { return { policyVersion: 'test', accepted: true, acceptedAt: '2026-08-11T05:55:00.000Z' }; },
      async acceptPolicy() { return { policyVersion: 'test', accepted: true, acceptedAt: '2026-08-11T05:55:00.000Z' }; },
      async startSession() { return canonicalIds; },
      async append(payload) {
        if (failuresRemaining-- > 0) throw new TypeError('injected temporal append failure');
        writes.push(structuredClone(payload));
      },
      async deleteCurrentUserTrace() { return { deletedSessions: 0, deletedEntries: 0 }; },
      async listAdminSessions() { return []; },
      async listAdminEntries() { return []; },
      async archiveAdminSession() {},
    };
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(createRemoteWeeklyPlanningTraceRepository(api));
    try {
      const document = existingSourceDocument();
      document.tasks[0].workloads[0].amount = 12;
      document.tasks[0].temporalConstraints = [{
        localId: 'temporal-1', targetLocalId: 'task-math',
        kind: 'earliest_start',
        constraintLevel: 'hard',
        dateExpression: '2026-08-21',
        namedTimePeriod: null, startTime: '20:00', endTime: null,
        precision: 'exact', sourceText: '8月21日は20時以降',
      }];
      const userText = '8月17日から23日で数学12ページ。1ページ5分くらい。8月21日は20時以降。既存予定';
      document.tasks[0].sourceText = '数学12ページ。1ページ5分くらい';
      document.tasks[0].workloads[0].sourceText = '数学12ページ';
      const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: userText });
      expect(validation.errors).toEqual([]); expect(validation.document).not.toBeNull();
      // External interpretation is substituted; validation, pipeline, runtime/placement and trace owners are real.
      normalizeMock.mockResolvedValueOnce(acceptedResult(validation.document!));
      const traceRequestId = `${conversationId}:request:1`;
      const input = { ...turnInput({ userText, traceRequestId }), conversationId, monthEvents: [existingEvent()] };
      const result = await executeWeeklyPlanningStableV5RuntimeTurn(input);
      expect(result.draftCandidates).toHaveLength(1);
      const acceptedGraph = result.stableV5Graph!;
      expect(acceptedGraph.workloads[0]).toMatchObject({ amount: 12, unitCode: 'page' });
      expect(acceptedGraph.effortEstimates[0]).toMatchObject({ kind: 'duration_per_unit', minutes: 5 });
      expect(acceptedGraph.workloads[0].amount! * acceptedGraph.effortEstimates[0].minutes).toBe(60);
      // Existing 1.1 safety buffer and five-minute upward rounding: 60 -> 66 -> 70.
      // Existing appointment ends at 20:00; preserve the source's 10-minute busy buffer plus 10-minute placement break.
      expect(result.draftCandidates[0]).toMatchObject({ date: '2026-08-21', startTime: '20:20', endTime: '21:30', durationMinutes: 70 });
      const evidence = result.existingScheduleGrounding;
      expect(evidence).toEqual({ graphRevision: result.stableV5Graph!.revision,
        sourceId: 'studyplanner-existing-plans', requestFactId: result.stableV5Graph!.constraintSourceRequests[0].id,
        occupiedEventIds: ['existing-event-grounding'] });
      expect(result.state).not.toHaveProperty('existingScheduleGrounding');
      const renderedText = `${claim}「この内容で仮予定にする」を押してください。`;
      rendererClientMock.mockImplementationOnce(async request => {
        const payload = JSON.parse(request.messages[request.messages.length - 1].content);
        expect(payload.applicationDecision.existingScheduleGrounding).toEqual(evidence);
        return JSON.stringify({ actionId: payload.actionId, actionKind: 'preview_ready', questionCode: null,
          groundingAcknowledgement: null, text: renderedText });
      });
      const rendered = await renderWeeklyPlanningStableV5AssistantMessage({ input, result });
      expect(rendererClientMock).toHaveBeenCalledTimes(1);
      expect(rendered.responseSource).toBe('ai');
      expect(rendered.message).toBe(renderedText);
      const rendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(rendered.dialogueRendererTrace!);
      const promptContext = rendererTrace.request!.promptContext as Record<string, unknown>;
      expect(promptContext.existingScheduleGrounding).toEqual(evidence);
      const delivered = rendererClientMock.mock.calls[0][0];
      expect(promptContext.messages).toEqual(delivered.messages);
      (promptContext.existingScheduleGrounding as Record<string, unknown>).futureGroundingField = 'future-existing-schedule';
      const events = takeWeeklyPlanningStableV5DebugTrace(traceRequestId);
      const evaluation = events.find((event) => event.stage === 'runtime_scheduler_dialogue_evaluated');
      expect(evaluation).toBeDefined();
      const horizon = (evaluation!.data as { resolvedHorizon: Record<string, unknown> }).resolvedHorizon;
      expect(horizon).toEqual({ startDate: '2026-08-17', endDate: '2026-08-23' });
      horizon.futureTemporalScopeField = 'future-temporal-scope-field';
      const compilation = (evaluation!.data as { compilation: { hardClockBounds?: Array<Record<string, unknown>> } }).compilation;
      const expectedClockBounds = [{
        taskId: result.stableV5Graph!.tasks[0].id, targetFactId: result.stableV5Graph!.tasks[0].id,
        sourceFactId: result.stableV5Graph!.temporalConstraints[0].id,
        kind: 'earliest_start', minute: 1200, anchorDate: '2026-08-21',
      }];
      expect(compilation.hardClockBounds).toEqual(expectedClockBounds);
      compilation.hardClockBounds![0].futureClockField = 'future-hard-clock-field';
      const first = {
        userId, conversationId, requestId: traceRequestId, userText,
        assistantMessage: rendered.message, responseSource: 'ai' as const, dialogueRendererTrace: rendererTrace,
        outcome: 'scheduler_ready',
        previewCount: result.draftCandidates.length, debugTraceEvents: events,
      };
      await recordWeeklyPlanningStableV5TurnTrace(first);
      expect(writes).toHaveLength(0);
      expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);
      expect(JSON.parse(window.localStorage.getItem('studyplanner.weeklyPlanning.trace.outbox.v1')!).items[0].input).toEqual(first);

      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      setWeeklyPlanningTraceRepositoryForTests(createRemoteWeeklyPlanningTraceRepository(api));
      const oversized = structuredClone(first);
      oversized.requestId = `${conversationId}:request:2`;
      (oversized.dialogueRendererTrace.request!.promptContext as Record<string, unknown>).futureLargeGroundingField = 'existing-schedule-extension'.repeat(10_000);
      const largeEvaluation = oversized.debugTraceEvents.find((event) => event.stage === evaluation!.stage)!;
      (largeEvaluation.data as { resolvedHorizon: Record<string, unknown> }).resolvedHorizon.futureLargeScopeField = 'temporal-extension'.repeat(10_000);
      (largeEvaluation.data as { compilation: { hardClockBounds: Array<Record<string, unknown>> } })
        .compilation.hardClockBounds[0].oversizedClockField = 'hard-clock-extension'.repeat(10_000);
      await recordWeeklyPlanningStableV5TurnTrace(oversized);
      expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
      expect(writes).toHaveLength(2);
      for (const [index, write] of writes.entries()) {
        expect(write.entries).toHaveLength(1);
        const entry = write.entries[0];
        if (entry.kind !== 'turn_diagnostic') throw new Error('expected actual runtime diagnostic');
        expect(entry.userId).toBeUndefined();
        expect(entry.sessionId).toBe(canonicalIds.sessionId);
        expect(entry.logicalConversationId).toBe(canonicalIds.logicalConversationId);
        expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        const prepared = prepareWeeklyPlanningTraceServerWrite({
          session: write.session as unknown as Record<string, unknown>, entries: [entry] as unknown as Record<string, unknown>[],
        }, { token: `wpt_${'f'.repeat(43)}`, epoch: '107' }, canonicalIds, '2026-08-11T05:55:00.000Z');
        expect(prepared.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        for (const persisted of [entry, prepared.entries[0]]) {
          const serialized = JSON.stringify(persisted);
          if (index === 0) {
            expect(serialized).toContain('future-temporal-scope-field');
            expect(serialized).toContain('future-existing-schedule');
            expect(serialized).toContain('existing-event-grounding');
            const renderer = (persisted as { diagnostics: { dialogueRenderer: typeof rendererTrace } }).diagnostics.dialogueRenderer;
            expect(renderer.response.renderedText).toBe(renderedText);
            expect(renderer.decision.finalMessage).toBe(renderedText);
            expect(serialized).toContain('2026-08-21');
            const diagnostic = persisted as { constraintContext: { scheduler?: { hardClockBounds?: unknown } } };
            expect(diagnostic.constraintContext.scheduler?.hardClockBounds).toEqual([
              { ...expectedClockBounds![0], futureClockField: 'future-hard-clock-field' },
            ]);
          } else {
            expect(serialized).toMatch(/traceProjectionTruncated|traceTruncated|truncated/u);
            expect(serialized).not.toContain('temporal-extension'.repeat(10_000));
            expect(serialized).not.toContain('existing-schedule-extension'.repeat(10_000));
            const diagnostic = persisted as { constraintContext: { scheduler?: { hardClockBounds?: unknown } } };
            expect(diagnostic.constraintContext.scheduler?.hardClockBounds).toMatchObject({ traceTruncated: true });
            expect(serialized).not.toContain('hard-clock-extension'.repeat(10_000));
          }
        }
      }
    } finally {
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      restoreStorage();
      vi.unstubAllEnvs();
    }
  });

});