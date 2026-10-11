import { recordFailedWeeklyPlanningApplicationTurn } from './application/weeklyPlanningTurnTraceSideEffects';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './trace/weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './trace/weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceSession, WeeklyPlanningTraceEntry } from './trace/weeklyPlanningTraceTypes';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createStableV5SemanticPublicStateSummary } from './application/weeklyPlanningStableV5SemanticContext';
import { describe, expect, it, vi } from 'vitest';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from './application/weeklyPlanningStableV5SessionCodec';
import {
  loadWeeklyPlanningStableV5PersistedSession,
  saveWeeklyPlanningStableV5PersistedSession,
} from './application/weeklyPlanningStableV5SessionStorage';
import {
  commitWeeklyPlanningStableV5RuntimeGraph,
  getWeeklyPlanningStableV5RuntimeSession,
  hasWeeklyPlanningStableV5StagedGraph,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './application/weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnStagingLifecycle } from './application/weeklyPlanningTurnSideEffects';
import {
  resolveWeeklyPlanningQuestionPresentationFreshness,
  type WeeklyPlanningQuestionPresentationFreshness,
} from './intake/weeklyPlanningQuestionPresentation';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import type { PlanningState, WeeklyPlanningAction } from './types';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
  type SubmitWeeklyPlanningControlledTurnParams,
} from './weeklyPlanningTurnController';
import { executeWeeklyPlanningTurn, type WeeklyPlanningTurnExecutionResult } from './weeklyPlanningTurnExecutor';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from './testUtils/weeklyPlanningApplicationTestHarness';

const scriptedProvider = vi.hoisted(() => vi.fn());
vi.mock('../../lib/aiConfig', async (original) => ({
  ...await original<typeof import('../../lib/aiConfig')>(),
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.test/v1', model: 'fixture', apiKey: 'fixture' }),
  getAiConfigValidationMessage: () => null,
}));
vi.mock('../../services/ai/openAiCompatibleClient', async (original) => ({
  ...await original<typeof import('../../services/ai/openAiCompatibleClient')>(),
  createOpenAiCompatibleClient: () => ({ createChatCompletion: scriptedProvider }),
}));

const OWNER_ID = 'owner-1';
const WEEK_START = '2026-09-28';
const CONVERSATION_ID = 'conversation-1';
const GRAPH_REVISION = 3;

function graph() {
  return { ...createEmptyWeeklyPlanningFactGraphV5(), revision: GRAPH_REVISION };
}

function intakeState(): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: ['分散学習の提案（1回15〜30分）について、採用するか教えてください。'],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    groundingRecords: [],
    repairAgenda: [],
    learningStrategyProposalRecords: [],
    sourceTurns: ['英単語を覚えたい'],
    lastQuestionContext: {
      kind: 'options',
      targetSlot: 'stable_v5:learning_strategy_proposal',
      intent: 'learning_strategy_proposal',
      topicId: 'workload-1',
      actionId: 'wpp_memory_abc',
    },
  };
}

function presentingResult(
  overrides: Partial<WeeklyPlanningTurnExecutionResult> = {},
): WeeklyPlanningTurnExecutionResult {
  return {
    state: intakeState(),
    message: '分散学習の提案（1回15〜30分）について、採用するか教えてください。',
    draftCandidates: [],
    stableV5Graph: graph(),
    responseSource: 'ai',
    questionPresentationContent: {
      responseSource: 'ai',
      currentTurnGrounding: 'none',
      selfRepairNotice: false,
    groundingContext: { proposed: 0, contested: 0 },
    previewPromotionControl: false,},
    ...overrides,
  };
}

function harness(initialState = createInitialPlanningState(WEEK_START)) {
  let state: PlanningState = initialState;
  const session = createWeeklyPlanningControllerSession(OWNER_ID, WEEK_START, CONVERSATION_ID);
  const dispatch = (action: WeeklyPlanningAction) => {
    state = weeklyPlanningReducer(state, action);
    return state;
  };
  let observed: WeeklyPlanningQuestionPresentationFreshness | undefined;
  async function submit(
    userText: string,
    execute: () => Promise<WeeklyPlanningTurnExecutionResult>,
    lifecycle: Pick<SubmitWeeklyPlanningControlledTurnParams,
      'prepareExecutionCommit' | 'discardExecutionResult' | 'onFailedTurn'> = {},
  ) {
    return submitWeeklyPlanningControlledTurn({
      ...lifecycle,
      session,
      ownerId: OWNER_ID,
      userText,
      getState: () => state,
      dispatch,
      async execute({ snapshot, pending }) {
        observed = resolveWeeklyPlanningQuestionPresentationFreshness({
          previousState: snapshot.intakeState,
          inputStateRevision: pending.baseRevision,
          messages: snapshot.messages,
          graphRevision: GRAPH_REVISION,
        });
        return execute();
      },
      now: () => '2026-09-28T09:00:00.000Z',
    });
  }
  return {
    getState: () => state,
    setState: (next: PlanningState) => { state = next; },
    dispatch,
    submit,
    observed: () => observed,
  };
}

describe('question presentation binding across the turn commit boundary', () => {
  it('stamps the committed assistant message, state revision, and graph revision', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());

    const state = h.getState();
    const lastMessage = state.messages[state.messages.length - 1];
    expect(lastMessage.role).toBe('assistant');
    expect(state.intakeState?.lastQuestionContext?.presentation).toEqual({
      version: 1,
      turnId: lastMessage.id.replace(/:assistant$/, ''),
      assistantMessageId: lastMessage.id,
      planningStateRevision: state.revision,
      graphRevision: GRAPH_REVISION,
      content: {
        responseSource: 'ai',
        currentTurnGrounding: 'none',
        selfRepairNotice: false,
      groundingContext: { proposed: 0, contested: 0 },
      previewPromotionControl: false,},
    });
  });

  it('lets the next turn see the presentation as fresh', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    await h.submit('いいえ', async () => presentingResult());

    expect(h.observed()).toMatchObject({
      status: 'fresh',
      questionContext: { actionId: 'wpp_memory_abc' },
    });
  });

  it('does not bind a result that did not describe its presentation', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult({
      questionPresentationContent: undefined,
    }));

    expect(h.getState().intakeState?.lastQuestionContext).not.toHaveProperty('presentation');
    await h.submit('いいえ', async () => presentingResult());
    expect(h.observed()).toEqual({ status: 'unbound' });
  });

  it('becomes stale after a message is appended outside the turn', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    h.dispatch({ type: 'set_last_assistant_message', message: '保存しました。' });
    await h.submit('いいえ', async () => presentingResult());

    expect(h.observed()).toEqual({ status: 'stale', reason: 'state_revision_mismatch' });
  });

  it('becomes stale after a failed turn keeps the old question', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    await expect(h.submit('えっと', async () => {
      throw new Error('provider unavailable');
    })).rejects.toThrow();
    expect(h.getState().intakeState?.lastQuestionContext?.actionId).toBe('wpp_memory_abc');

    await h.submit('いいえ', async () => presentingResult());
    expect(h.observed()).toEqual({ status: 'stale', reason: 'state_revision_mismatch' });
  });

  it('replaces the binding when the next turn presents again', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    const first = h.getState().intakeState?.lastQuestionContext?.presentation;
    await h.submit('もう一度', async () => ({
      ...presentingResult(),
      // A route that reuses the previous question context must not keep the old binding.
      state: h.getState().intakeState!,
    }));
    const second = h.getState().intakeState?.lastQuestionContext?.presentation;

    expect(second?.assistantMessageId).not.toBe(first?.assistantMessageId);
    expect(second?.planningStateRevision).toBe(h.getState().revision);
  });

  it('survives the Stable V5 checkpoint round trip and stays fresh after reload', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    const preparation = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: graph(),
      planningState: h.getState(),
    });
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') return;

    const restored = parseWeeklyPlanningStableV5PersistedSession({
      raw: JSON.stringify({
        version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
        ownerId: OWNER_ID,
        weekStartDate: WEEK_START,
        conversationId: CONVERSATION_ID,
        graph: graph(),
        planningState: preparation.planningState,
        savedAt: '2026-09-28T09:00:01.000Z',
      }),
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
    });
    expect(restored?.planningState.intakeState?.lastQuestionContext?.presentation)
      .toEqual(h.getState().intakeState?.lastQuestionContext?.presentation);

    h.dispatch({ type: 'load_state', state: restored!.planningState });
    await h.submit('いいえ', async () => presentingResult());
    expect(h.observed()).toMatchObject({ status: 'fresh' });
  });

  // Boundary fixtures, not live renderer/semantic evidence. The stop deliberately carries
  // the previous AI presentation metadata, matching the #563 technical-stop defect.
  // A system stop must not turn that old metadata into evidence that it asked a question.
  it.each([
    { name: 'a technical stop without a question', source: 'system' as const, asks: false,
      message: '返信を作れませんでした。もう一度送信してください。' },
    { name: 'an AI recovery that presents the retained question', source: 'ai' as const, asks: true,
      message: '先ほどの分散学習の提案は、採用しますか？' },
  ])('retains state and reloads the actual presentation for $name', async ({ source, asks, message }) => {
    const storage = createMemoryStorageHarness();
    const restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    try {
      const acceptedGraph = graph();
      acceptedGraph.appliedTurnKeys = [`${CONVERSATION_ID}:${CONVERSATION_ID}:request:1`];
      const factSource = { conversationId: CONVERSATION_ID, turnId: 'setup',
        semanticLocalId: 'task', sourceText: '英単語を20語', origin: 'user' as const };
      acceptedGraph.tasks = [{ id: 'task-1', category: 'study', title: '英単語',
        source: factSource, createdRevision: 1 }];
      acceptedGraph.workloads = [{ id: 'workload-1', taskId: 'task-1', componentId: null,
        quantityRole: 'target', amount: 20, unitCode: 'word', unitLabel: '語',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source: { ...factSource, semanticLocalId: 'workload' }, createdRevision: 1 }];
      acceptedGraph.factLifecycles = ['task-1', 'workload-1'].map(factId => ({
        factId, status: 'active' as const, createdRevision: 1,
        terminalRevision: null, supersededByFactId: null,
      }));
      const retainedPreview = [{ stableKey: 'retained-preview', date: WEEK_START,
        startTime: '18:00', endTime: '18:30', durationMinutes: 30, title: '英単語',
        field: '英語', year: 0, estimatedMinutes: 30, source: 'weekly_exam_prep' as const,
        approvalStatus: 'unapproved' as const, workItemKey: 'workload-1',
        stableV5Metadata: { runtime: 'stable_v5' as const, conversationId: CONVERSATION_ID,
          graphRevision: GRAPH_REVISION, taskId: 'task-1',
          sourceFactRefs: ['task-1', 'workload-1'], planType: 'study' as const } }];
      const h = harness();
      hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER_ID, weekStartDate: WEEK_START,
        conversationId: CONVERSATION_ID, graph: acceptedGraph });
      await h.submit('英単語を覚えたい', async () => presentingResult({
        stableV5Graph: acceptedGraph, draftCandidates: retainedPreview,
      }));
      const before = structuredClone(h.getState());
      const held = before.intakeState!.lastQuestionContext!.presentation!;
      expect(resolveWeeklyPlanningQuestionPresentationFreshness({
        previousState: before.intakeState, inputStateRevision: before.revision,
        messages: before.messages, graphRevision: acceptedGraph.revision,
      }).status).toBe('fresh');
      let failedRequestId = '';
      let prepared = false;
      let discarded = false;
      await h.submit('それはどうすれば', async () => {
        failedRequestId = h.getState().pendingTurn!.requestId;
        const rejectedGraph = { ...acceptedGraph, revision: GRAPH_REVISION + 1,
          appliedTurnKeys: [...acceptedGraph.appliedTurnKeys, `${CONVERSATION_ID}:${failedRequestId}`] };
        commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: OWNER_ID,
          conversationId: CONVERSATION_ID, graph: rejectedGraph });
        expect(hasWeeklyPlanningStableV5StagedGraph({ conversationId: CONVERSATION_ID,
          requestId: failedRequestId })).toBe(true);
        return {
          // Deliberately malformed runtime state must not gain saving authority on failure.
          ...presentingResult({ state: { ...before.intakeState!, shouldCreateDraft: true,
            shouldSavePlan: true, sourceTurns: ['REJECTED-TURN-MUST-NOT-BECOME-STATE'] } as unknown as PlanningIntakeState,
          message, stableV5Graph: undefined, responseSource: source,
          questionPresentationContent: held.content }),
          // Source #563's field is deliberately supplied at this boundary without adding
          // it to main's production type. The failed turn has no newly committed graph.
          questionPresentationGraphRevision: GRAPH_REVISION,
          // The positive fixture now supplies the production verifier's typed receipt.
          ...(asks ? { recoveryPresentation: { question: { graphRevision: GRAPH_REVISION,
            previousAssistantMessageId: held.assistantMessageId } } } : {}),
          failure: { code: 'stable_v5_normalization_rejected' as const, userMessage: message,
            traceCode: 'recovery-correspondence-fixture', diagnostics: {
              attemptCount: 2, repairAttempted: true,
              validationErrorCategories: ['invalid_json'], providerErrorCategory: null } },
        };
      }, {
        prepareExecutionCommit({ pending }) {
          prepared = true;
          return weeklyPlanningTurnStagingLifecycle.prepare({ ownerId: OWNER_ID, pending });
        },
        discardExecutionResult({ pending, reason }) {
          expect(reason).toBe('failed');
          discarded = true;
          weeklyPlanningTurnStagingLifecycle.discard(pending);
        },
      });
      const after = h.getState();
      const latest = after.messages[after.messages.length - 1];
      expect(prepared).toBe(false);
      expect(discarded).toBe(true);
      expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION_ID)?.graph).toEqual(acceptedGraph);
      expect(hasWeeklyPlanningStableV5StagedGraph({ conversationId: CONVERSATION_ID,
        requestId: failedRequestId })).toBe(false);
      expect(after.previewCandidates).toEqual(before.previewCandidates);
      expect(after.draftBlocks).toEqual(before.draftBlocks);
      expect(after.intakeState?.sourceTurns).toEqual(before.intakeState?.sourceTurns);
      expect(after.intakeState?.shouldCreateDraft).toBe(before.intakeState?.shouldCreateDraft);
      expect(after.intakeState?.shouldSavePlan).toBe(before.intakeState?.shouldSavePlan);
      expect(after.intakeState?.lastQuestionContext?.actionId).toBe('wpp_memory_abc');
      expect(after.pendingTurn).toBeUndefined();
      expect(after.revision).toBe(before.revision + 2);
      expect(latest.content).toBe(message); // Fixture transport, not a production wording oracle.
      const fresh = resolveWeeklyPlanningQuestionPresentationFreshness({
        previousState: after.intakeState, inputStateRevision: after.revision,
        messages: after.messages, graphRevision: acceptedGraph.revision });
      expect(fresh.status === 'fresh').toBe(asks);
      if (asks) {
        expect(after.intakeState?.lastQuestionContext?.presentation?.assistantMessageId).toBe(latest.id);
      } else {
        expect(after.intakeState?.lastQuestionContext?.presentation?.assistantMessageId).not.toBe(latest.id);
      }

      expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER_ID, weekStartDate: WEEK_START,
        conversationId: CONVERSATION_ID, graph: acceptedGraph, planningState: after })).toBe(true);
      expect(storage.values.size).toBeGreaterThan(0);
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      const restored = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER_ID, weekStartDate: WEEK_START });
      expect(restored).not.toBeNull();
      if (!restored) throw new Error('The recovery checkpoint did not reload.');
      expect(restored.graph).toEqual(acceptedGraph);
      expect(restored.planningState.previewCandidates).toEqual(before.previewCandidates);
      expect(restored.planningState.intakeState?.lastQuestionContext).toEqual(after.intakeState?.lastQuestionContext);
      hydrateWeeklyPlanningStableV5RuntimeSession(restored);
      const reloaded = harness(restored.planningState);
      await reloaded.submit('いいえ', async () => presentingResult({ stableV5Graph: restored.graph }));
      expect(reloaded.observed()?.status === 'fresh').toBe(asks);
      const summary = createStableV5SemanticPublicStateSummary({ graph: restored.graph,
        previousState: restored.planningState.intakeState,
        inputStateRevision: restored.planningState.revision, messages: restored.planningState.messages });
      expect(summary.pendingQuestion !== null).toBe(asks);
    } finally {
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      restoreStorage();
    }
  });

  it('does not treat AI source and old metadata as a verified recovery question', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    const held = h.getState().intakeState!.lastQuestionContext!.presentation!;
    await h.submit('それは', async () => presentingResult({ responseSource: 'ai',
      questionPresentationContent: held.content,
      failure: { code: 'stable_v5_normalization_rejected', userMessage: '質問に戻ります。', traceCode: 'unverified',
        diagnostics: { attemptCount: 2, repairAttempted: true, validationErrorCategories: [], providerErrorCategory: null } },
    }));
    expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: h.getState().intakeState,
      inputStateRevision: h.getState().revision, messages: h.getState().messages, graphRevision: GRAPH_REVISION }).status)
      .not.toBe('fresh');
  });


  it.each([true, false])('composes real rejected semantic turn, renderer, controller, storage and failed trace (verified=%s)', async (verified) => {
    const storage = createMemoryStorageHarness();
    const restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    scriptedProvider.mockReset();
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let failFirstWrite = true;
    setWeeklyPlanningTraceRepositoryForTests({
      async upsertSession() {}, async appendEntries(value) {
        if (failFirstWrite) { failFirstWrite = false; throw new Error('outbox fixture'); }
        writes.push(structuredClone(value));
      }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    });
    try {
      const accepted = graph();
      const source = { conversationId: CONVERSATION_ID, turnId: 'accepted', semanticLocalId: 'task',
        sourceText: '英単語を20語', origin: 'user' as const };
      accepted.tasks = [{ id: 'task-1', category: 'study', title: '英単語', source, createdRevision: 1 }];
      accepted.workloads = [{ id: 'workload-1', taskId: 'task-1', componentId: null,
        quantityRole: 'target', amount: 20, unitCode: 'word', unitLabel: '語', rangeStart: null,
        rangeEnd: null, perOccurrence: false, periodExpression: null, source: { ...source, semanticLocalId: 'workload' }, createdRevision: 1 }];
      accepted.factLifecycles = ['task-1', 'workload-1'].map(factId => ({ factId, status: 'active' as const,
        createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
      const preview = [{ stableKey: 'retained-preview', date: WEEK_START, startTime: '18:00', endTime: '18:30',
        durationMinutes: 30, title: '英単語', field: '英語', year: 0, estimatedMinutes: 30,
        source: 'weekly_exam_prep' as const, approvalStatus: 'unapproved' as const, workItemKey: 'workload-1',
        stableV5Metadata: { runtime: 'stable_v5' as const, conversationId: CONVERSATION_ID,
          graphRevision: GRAPH_REVISION, taskId: 'task-1', sourceFactRefs: ['task-1', 'workload-1'], planType: 'study' as const } }];
      const previous = { ...intakeState(), lastQuestionContext: { kind: 'missing' as const,
        targetSlot: 'stable_v5:missing_effort_estimate', intent: 'total_duration', topicId: 'workload-1' } };
      hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER_ID, weekStartDate: WEEK_START,
        conversationId: CONVERSATION_ID, graph: accepted });
      const h = harness();
      await h.submit('英単語を20語', async () => presentingResult({ state: previous, stableV5Graph: accepted,
        draftCandidates: preview, message: '英単語20語には、合計でどれくらい時間がかかりますか？' }));
      const before = structuredClone(h.getState());
      const privateBinding = before.intakeState!.lastQuestionContext!.presentation!.assistantMessageId;
      scriptedProvider.mockImplementation(async (request) => {
        if (request.purpose === 'weekly_planning_semantic_normalizer') return '{';
        const body = JSON.parse(request.messages[1].content);
        if (request.responseFormat.json_schema.name === 'weekly_planning_recovery_verdict') {
          expect(body.question.identityEvidence.labels).toContain('英単語');
          return JSON.stringify({ actionId: body.actionId, questionMatches: verified ? 'yes' : 'no',
            planningDetailsNotApplied: 'yes', acceptedStateUnchanged: 'yes',
            retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' });
        }
        return JSON.stringify({ actionId: body.actionId, actionKind: body.applicationDecision.actionKind,
          questionCode: body.applicationDecision.questionCode, groundingAcknowledgement: null,
          text: '今回の変更はまだ反映していません。以前の候補はそのままです。英単語20語を終える合計時間は、何分ほどでしょうか？' });
      });
      let actualResult: WeeklyPlanningTurnExecutionResult | undefined;
      await h.submit('英単語を200語に増やして', async () => {
        const pending = h.getState().pendingTurn!;
        actualResult = await executeWeeklyPlanningTurn({ previousState: before.intakeState,
          messages: before.messages, inputStateRevision: before.revision, userText: '英単語を200語に増やして',
          selectedDate: WEEK_START, userId: OWNER_ID, plans: [], scheduleTemplates: [],
          conversationId: CONVERSATION_ID, traceRequestId: pending.requestId,
          retainedPreviewCount: before.previewCandidates?.length ?? 0,
          isCurrentTurn: () => h.getState().pendingTurn?.requestId === pending.requestId });
        return actualResult;
      }, {
        prepareExecutionCommit() { throw new Error('A rejected turn must never prepare a commit'); },
        discardExecutionResult({ pending }) { weeklyPlanningTurnStagingLifecycle.discard(pending); },
        async onFailedTurn(params) {
          await recordFailedWeeklyPlanningApplicationTurn({ ownerId: OWNER_ID, pending: params.pending,
            userText: params.userText, result: params.result, error: params.error, assistantMessage: params.assistantMessage });
        },
      });
      const after = h.getState();
      expect(actualResult?.responseSource).toBe(verified ? 'ai' : 'system');
      expect(actualResult?.recoveryPresentation !== undefined).toBe(verified);
      expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION_ID)?.graph).toEqual(accepted);
      expect(after.previewCandidates).toEqual(before.previewCandidates);
      expect(after.draftBlocks).toEqual(before.draftBlocks);
      expect(after.intakeState?.sourceTurns).toEqual(before.intakeState?.sourceTurns);
      expect(after.intakeState?.shouldSavePlan).toBe(false);
      const calls = scriptedProvider.mock.calls.map(([request]) => request);
      expect(calls.filter(request => request.purpose === 'weekly_planning_renderer')).toHaveLength(2);
      expect(calls.length).toBeLessThanOrEqual(8);
      expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER_ID, weekStartDate: WEEK_START,
        conversationId: CONVERSATION_ID, graph: accepted, planningState: after })).toBe(true);
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      const restored = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER_ID, weekStartDate: WEEK_START })!;
      expect(restored.graph).toEqual(accepted);
      expect(restored.planningState.previewCandidates).toEqual(preview);
      expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: restored.planningState.intakeState,
        inputStateRevision: restored.planningState.revision, messages: restored.planningState.messages,
        graphRevision: restored.graph.revision }).status === 'fresh').toBe(verified);
      expect(createStableV5SemanticPublicStateSummary({ graph: restored.graph,
        previousState: restored.planningState.intakeState, messages: restored.planningState.messages,
        inputStateRevision: restored.planningState.revision }).pendingQuestion !== null).toBe(verified);

      expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER_ID, conversationId: CONVERSATION_ID })).toHaveLength(1);
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace({ userId: OWNER_ID, conversationId: CONVERSATION_ID,
        requestId: 'flush-recovery', userText: 'flush', assistantMessage: 'flush', responseSource: 'system',
        outcome: 'failed', previewCount: 0, debugTraceEvents: [] });
      expect(writes).toHaveLength(2);
      const retried = writes[0];
      const serialized = JSON.stringify(retried.entries[0]);
      expect(serialized).toContain('weekly_planning_recovery_verdict');
      const expectedDispatch = { count: calls.filter(request => request.purpose === 'weekly_planning_semantic_normalizer').length,
        anyFailure: false, complete: true };
      expect(retried.entries[0]).toMatchObject({ diagnostics: { providerDispatch: expectedDispatch } });
      expect(serialized).not.toContain(privateBinding);
      expect(serialized).not.toContain('previousAssistantMessageId');
      expect(serialized).not.toContain('recoveryPresentation');
      expect(measureWeeklyPlanningTraceJsonBytes(retried.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: retried.session as unknown as Record<string, unknown>,
        entries: retried.entries as unknown as Record<string, unknown>[],
      }, { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, {
        sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000',
        logicalConversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
      }, '2026-10-10T00:00:00.000Z');
      const persisted = JSON.stringify(prepared.entries[0]);
      expect(persisted).toContain('weekly_planning_recovery_verdict');
      expect(prepared.entries[0]).toMatchObject({ diagnostics: { providerDispatch: expectedDispatch } });
      expect(persisted).not.toContain(privateBinding);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    } finally {
      resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
      setWeeklyPlanningTraceRepositoryForTests(undefined); scriptedProvider.mockReset(); restore();
    }
  });

});
