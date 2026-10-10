import { executeWeeklyPlanningStableV5RuntimeTurn as executeInstrumentedTurn } from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import * as planningEvaluation from './weeklyPlanningStableV5PlanningEvaluation';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createStableV5SemanticPublicStateSummary } from './weeklyPlanningStableV5SemanticContext';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import { takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import { classifyWeeklyPlanningApprovalAvailability } from './weeklyPlanningApprovalAvailability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  getWeeklyPlanningStableV5RuntimeSession,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));

function nextWeekOnlyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-next-week',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週',
    },
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function workOnlyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: { purpose: 'homework', contextLabel: '数学', components: [] },
      workloads: [{
        localId: 'workload-math', quantityRole: 'target', amount: 30,
        unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: '数学30ページ',
      }],
      effortEstimates: [{
        localId: 'effort-math', targetLocalId: 'workload-math', kind: 'total_duration',
        minutes: 60, unitCode: null, precision: 'approximate', sourceText: '1時間くらい',
      }],
      temporalConstraints: [], recurrence: [], sourceText: '数学30ページを1時間くらい',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

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

vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({
    provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test-model', apiKey: 'test-key',
  }),
  getAiConfigValidationMessage: () => undefined,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({ createChatCompletion: vi.fn() }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));

import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5RuntimeExecutor';

const requestContext = {
  startedAtIso: '2026-08-11T05:55:00.000Z',
  timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-11',
  currentTime: '14:55',
  notBeforeDate: '2026-08-11',
  notBeforeTime: '14:55',
  weekStartsOn: 'monday' as const,
};

describe('Stable V5 planning-window grounding integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the absolute interpretation of next week while moving on to the task question', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(nextWeekOnlyDocument()));

    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '来週の予定を立てたい',
      selectedDate: '2026-09-10',
      userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-grounding', traceRequestId: 'request-grounding-1',
      requestContext,
    });

    expect(result.message).toContain('8月17日〜23日');
    expect(result.message).toContain('教えてください');
    expect(result.state.groundingRecords).toEqual([
      expect.objectContaining({
        status: 'proposed', targetFactId: expect.any(String),
        startDate: '2026-08-17', endDate: '2026-08-23',
      }),
    ]);
  });

  it('treats a relevant answer to the projected task question as continuation acceptance', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(nextWeekOnlyDocument()));
    const first = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '来週の予定を立てたい', selectedDate: '2026-09-10',
      userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-grounding', traceRequestId: 'request-grounding-1',
      requestContext,
    });
    finalizeWeeklyPlanningStableV5RuntimeGraph({
      ownerId: 'owner-1', conversationId: 'conversation-grounding', requestId: 'request-grounding-1',
    });

    normalizeMock.mockResolvedValueOnce(acceptedResult(workOnlyDocument()));
    const second = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: first.state,
      messages: [
        { id: 'u1', role: 'user', content: '来週の予定を立てたい', createdAt: '2026-08-11T05:55:00.000Z' },
        { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-11T05:55:01.000Z' },
      ],
      userText: '数学30ページを1時間くらい', selectedDate: '2026-09-10',
      userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-grounding', traceRequestId: 'request-grounding-2',
      requestContext,
    });

    expect(second.state.groundingRecords).toEqual([
      expect.objectContaining({
        status: 'continuation_accepted',
        acceptedAtTurnId: 'request-grounding-2',
      }),
    ]);
  });

  it.each([false, true])('uses the reconciled frozen range for one shared temporal snapshot (reject=%s)', async (reject) => {
    const common = {
      messages: [], selectedDate: '2026-09-10', userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-grounding',
    };
    normalizeMock.mockResolvedValueOnce(acceptedResult(nextWeekOnlyDocument()));
    const first = await executeWeeklyPlanningStableV5RuntimeTurn({
      ...common, userText: '来週の計画', traceRequestId: 'request-grounding-1', requestContext,
    });
    const firstSession = finalizeWeeklyPlanningStableV5RuntimeGraph({
      ownerId: common.userId, conversationId: common.conversationId, requestId: 'request-grounding-1',
    });
    const document = workOnlyDocument();
    document.tasks[0].temporalConstraints = [{
      localId: 'preferred-friday', targetLocalId: 'task-math', kind: 'preferred_window', constraintLevel: 'soft',
      dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: '20:00', endTime: '22:00',
      precision: 'exact', sourceText: '金曜の20時から22時',
    }];
    if (reject) document.decisions = [{
      localId: 'reject-old-grounding', decision: 'reject',
      target: { kind: 'planning_window', publicId: firstSession.graph.planningWindows[0].id, localId: null, mention: null },
      sourceText: '以前の相対期間の解釈は採用しない',
    }];
    normalizeMock.mockResolvedValueOnce(acceptedResult(document));
    const second = await executeWeeklyPlanningStableV5RuntimeTurn({
      ...common, previousState: first.state, userText: '数学を金曜の夜に', traceRequestId: 'request-grounding-2',
      requestContext: { ...requestContext, startedAtIso: '2026-08-18T05:55:00.000Z', currentDate: '2026-08-18', notBeforeDate: '2026-08-18' },
    });
    expect(second.draftCandidates).toHaveLength(1);
    expect(second.draftCandidates[0]).toMatchObject({
      date: reject ? '2026-08-28' : '2026-08-21', startTime: '20:00',
    });
    expect(second.state.groundingRecords?.[0].status).toBe(reject ? 'rejected' : 'continuation_accepted');
  });

  it.each(['changed absolute', 'identical relative'] as const)(
    'keeps correction identity and accepted temporal basis aligned: %s', async shape => {
      // Observe the real typed result; persisted debug events intentionally compact it.
      const evaluationSpy = vi.spyOn(planningEvaluation, 'evaluateWeeklyPlanningStableV5Planning');
      const common = {
        messages: [], selectedDate: '2026-09-10', userId: 'owner-1', plans: [], scheduleTemplates: [],
        conversationId: 'conversation-grounding',
      };
      const document = workOnlyDocument();
      document.planningIntent = 'create_plan';
      document.planningWindow = shape === 'identical relative'
        ? nextWeekOnlyDocument().planningWindow
        : { localId: 'old-window', kind: 'absolute', value: '2026-08-17/2026-08-23',
            start: '2026-08-17', end: '2026-08-23', sourceText: '8月17日から23日' };
      document.tasks[0].temporalConstraints = [{
        localId: 'friday', targetLocalId: 'task-math', kind: 'preferred_window', constraintLevel: 'soft',
        dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: '20:00', endTime: '22:00',
        precision: 'exact', sourceText: '金曜20時から22時',
      }];
      normalizeMock.mockResolvedValueOnce(acceptedResult(document));
      const first = await executeInstrumentedTurn({ ...common, userText: '数学の計画',
        traceRequestId: 'combined-window-1', requestContext });
      expect(first.draftCandidates.length).toBeGreaterThan(0);
      expect(first.draftCandidates.every(row => row.date === '2026-08-21')).toBe(true);
      const session = finalizeWeeklyPlanningStableV5RuntimeGraph({ ...common, ownerId: common.userId, requestId: 'combined-window-1' });
      const graph = structuredClone(session.graph);
      const oldWindow = graph.planningWindows[0];
      // Reuse A's pre-turn Q->W fixture, never hand-mutate the correction result.
      const questionId = 'combined-window-question';
      graph.uncertainties.push({ id: questionId, targetFactId: oldWindow.id, field: 'opaque', reason: '対象期間を確認',
        source: oldWindow.source, createdRevision: graph.revision });
      graph.factLifecycles.push({ factId: questionId, status: 'active', createdRevision: graph.revision,
        terminalRevision: null, supersededByFactId: null });
      hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: common.userId, conversationId: common.conversationId,
        weekStartDate: session.weekStartDate, graph });
      const previousState = { ...first.state, status: 'revision_pending' as const, draftGenerationIntent: 'user_authorized' as const,
        questions: ['対象期間を確認'], lastQuestionContext: { kind: 'missing' as const,
          targetSlot: 'stable_v5:semantic_uncertainty', topicId: questionId, actionId: 'combined-window-question-action', intent: 'semantic_uncertainty' } };
      const correction = nextWeekOnlyDocument();
      correction.planningIntent = 'update_plan';
      correction.planningWindow = shape === 'identical relative'
        ? { ...correction.planningWindow!, localId: 'new-window' }
        : { localId: 'new-window', kind: 'absolute', value: '2026-08-24/2026-08-30',
            start: '2026-08-24', end: '2026-08-30', sourceText: '8月24日から30日に変更' };
      const userText = shape === 'identical relative' ? '来週という期間に改めて変更' : '8月24日から30日に変更';
      correction.planningWindow!.sourceText = userText;
      correction.corrections = [{ localId: 'replace-window', operation: 'replace', replacementLocalId: 'new-window',
        target: { kind: 'planning_window', publicId: oldWindow.id, localId: null, mention: null }, sourceText: userText }];
      normalizeMock.mockImplementationOnce(async (input: WeeklyPlanningSemanticNormalizerInputV5) => {
        const valid = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(correction), { ...input, currentUserText: input.userText });
        expect(valid.errors).toEqual([]);
        expect(valid.document).not.toBeNull();
        return acceptedResult(valid.document!);
      });
      const clock = shape === 'identical relative'
        ? { ...requestContext, currentDate: '2026-08-18', notBeforeDate: '2026-08-18', startedAtIso: '2026-08-18T05:55:00.000Z' }
        : requestContext;
      const result = await executeInstrumentedTurn({ ...common, previousState, userText,
        traceRequestId: 'combined-window-2', requestContext: clock });
      const next = result.stableV5Graph!;
      const active = createWeeklyPlanningActiveSchedulerGraphViewV5(next);
      expect(active.planningWindows).toHaveLength(1);
      const newWindow = active.planningWindows[0];
      expect(newWindow.id).not.toBe(oldWindow.id);
      expect(next.factLifecycles.find(row => row.factId === oldWindow.id)).toMatchObject({ status: 'superseded', supersededByFactId: newWindow.id });
      const events = takeWeeklyPlanningStableV5DebugTrace('combined-window-2');
      const semantic = events.find(event => event.stage === 'runtime_semantic_result_received')!.data as { canonicalization: { status: string } };
      expect(semantic.canonicalization.status).toBe('applied');
      const projectedEvaluation = events.find(event => event.stage === 'runtime_scheduler_dialogue_evaluated')!.data as { resolvedHorizon: unknown };
      expect(projectedEvaluation.resolvedHorizon).toEqual({ startDate: '2026-08-24', endDate: '2026-08-30' });
      const evaluationIndex = evaluationSpy.mock.calls.findIndex(([params]) => params.input.traceRequestId === 'combined-window-2');
      expect(evaluationIndex).toBeGreaterThanOrEqual(0);
      const evaluationResult = evaluationSpy.mock.results[evaluationIndex];
      if (evaluationResult?.type !== 'return') throw new Error('Expected the real correction evaluation to return');
      const evaluation = evaluationResult.value;
      expect(evaluation.schedulerContext.acceptedPlanningWindow).toEqual({ factId: newWindow.id, startDate: '2026-08-24', endDate: '2026-08-30' });
      if (shape === 'changed absolute') {
        expect(next.factLifecycles.find(row => row.factId === questionId)?.status).toBe('removed');
        expect(evaluation.compilation.input?.preferredPlacements).toContainEqual(expect.objectContaining({ dates: ['2026-08-28'] }));
        expect(result.draftCandidates.length).toBeGreaterThan(0);
        expect(result.draftCandidates.every(row => row.date === '2026-08-28' && row.startTime >= '20:00' && row.endTime <= '22:00')).toBe(true);
        expect(result.draftCandidates).not.toEqual(first.draftCandidates);
      } else {
        expect(next.factLifecycles.find(row => row.factId === questionId)?.status).toBe('active');
        expect(active.uncertainties.find(row => row.id === questionId)?.targetFactId).toBe(newWindow.id);
        expect(result.state.groundingRecords).toEqual(expect.arrayContaining([expect.objectContaining({ targetFactId: oldWindow.id, status: 'rejected' })]));
        expect(result.state.lastQuestionContext).toMatchObject({ targetSlot: 'stable_v5:semantic_uncertainty', topicId: questionId });
        // This core-only result has not crossed the presenting controller commit.
        // Keep the accepted uncertainty public, but do not invent displayed-question authority.
        expect(result.state.lastQuestionContext).not.toHaveProperty('presentation');
        const summary = createStableV5SemanticPublicStateSummary({ graph: next, messages: [], previousState: result.state });
        expect(summary.pendingQuestion).toBeNull();
        expect(summary.uncertainties).toContainEqual(expect.objectContaining({
          publicId: questionId, targetPublicId: newWindow.id,
        }));
        expect(result.draftCandidates).toEqual([]);
        expect(result.preserveExistingPreview).toBe(false);
      }
      expect(getWeeklyPlanningStableV5RuntimeSession(common.conversationId)!.graph).toEqual(graph);
      const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: first.draftCandidates, userId: common.userId, createdAt: requestContext.startedAtIso });
      expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId: common.userId }).kind).toBe('eligible');
      finalizeWeeklyPlanningStableV5RuntimeGraph({ ...common, ownerId: common.userId, requestId: 'combined-window-2' });
      expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId: common.userId }).kind).toBe('recompute_required');
    },
  );

});
