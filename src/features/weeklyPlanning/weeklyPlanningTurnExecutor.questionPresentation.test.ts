import { bindWeeklyPlanningQuestionPresentation } from './intake/weeklyPlanningQuestionPresentation';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './application/weeklyPlanningStableV5RuntimeSession';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';

const runtimeMock = vi.hoisted(() => vi.fn());
const rendererMock = vi.hoisted(() => vi.fn());
const failureMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.test/v1', model: 'model', apiKey: 'key' }),
}));
vi.mock('./application/weeklyPlanningStableV5InstrumentedRuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: runtimeMock,
}));
vi.mock('./semantic/weeklyPlanningStableV5FailureDiagnostics', () => ({
  takeWeeklyPlanningStableV5FailureDiagnostics: failureMock,
}));
vi.mock('./trace/weeklyPlanningStableV5DebugTrace', () => ({
  recordWeeklyPlanningStableV5DebugTrace: vi.fn(),
}));
vi.mock('./dialogue/weeklyPlanningStableV5AiDialogueRenderer', () => ({
  createAiWeeklyPlanningStableV5DialogueRenderer: () => ({ render: rendererMock }),
}));

const TURN_ID = 'request-2';

function questionState(): PlanningIntakeState {
  return {
    ...createInitialPlanningIntakeState(),
    status: 'revision_pending',
    questions: ['確認してください。'],
    lastQuestionContext: {
      kind: 'missing',
      targetSlot: 'stable_v5:semantic_uncertainty',
      intent: 'semantic_uncertainty',
    },
  };
}

function graphWithCurrentTurnCorrection() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  const source = (turnId: string, localId: string, text: string) => ({
    conversationId: 'conversation-1', turnId, semanticLocalId: localId, sourceText: text, origin: 'user' as const,
  });
  graph.revision = 2;
  graph.tasks = [{ id: 'task-english', category: 'study', title: '英単語', source: source('turn-1', 'task', '英単語'), createdRevision: 1 }];
  graph.workloads = [
    { id: 'old', taskId: 'task-english', componentId: null, quantityRole: 'target', amount: 80, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source: source('turn-1', 'old', '80ページ'), createdRevision: 1 },
    { id: 'new', taskId: 'task-english', componentId: null, quantityRole: 'target', amount: 80, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source: source(TURN_ID, 'new', '80語だよ'), createdRevision: 2 },
  ];
  graph.correctionIntents = [{
    id: 'correction', target: { kind: 'workload', publicId: 'old', factId: 'old', mention: '80ページ' },
    operation: 'replace', replacementFactId: 'new', source: source(TURN_ID, 'correction', '80語だよ'), createdRevision: 2,
  }];
  graph.factLifecycles = [
    { factId: 'task-english', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
    { factId: 'old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'new' },
    { factId: 'new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    { factId: 'correction', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
  ];
  return graph;
}

function execute() {
  return executeWeeklyPlanningTurn({
    messages: [], userText: '80語だよ', selectedDate: '2026-08-11', userId: 'user-1',
    plans: [], scheduleTemplates: [], conversationId: 'conversation-1', traceRequestId: TURN_ID,
  });
}

describe('Stable V5 question presentation content', () => {
  beforeEach(() => {
    runtimeMock.mockReset(); rendererMock.mockReset(); failureMock.mockReset();
    failureMock.mockReturnValue(null);
  });

  it('describes a question rendered alone', async () => {
    runtimeMock.mockResolvedValue({
      state: questionState(), message: '確認してください。', draftCandidates: [],
      stableV5Graph: createEmptyWeeklyPlanningFactGraphV5(),
    });
    rendererMock.mockResolvedValue({ status: 'rendered', text: '確認してください。', rawResponse: '{}' });

    const result = await execute();

    expect(result.questionPresentationContent).toEqual({
      responseSource: 'ai',
      currentTurnGrounding: 'none',
      selfRepairNotice: false,
    groundingContext: { proposed: 0, contested: 0 },
    previewPromotionControl: false,});
  });

  it('records the grounding and self-repair notice rendered with the question', async () => {
    runtimeMock.mockResolvedValue({
      state: questionState(), message: '確認してください。', draftCandidates: [],
      stableV5Graph: graphWithCurrentTurnCorrection(),
    });
    rendererMock.mockResolvedValue({ status: 'fallback', reason: 'provider_error', rawResponse: null });

    const result = await execute();

    expect(result.questionPresentationContent).toEqual({
      responseSource: 'deterministic_fallback',
      currentTurnGrounding: 'recommended',
      selfRepairNotice: true,
    groundingContext: { proposed: 0, contested: 0 },
    previewPromotionControl: false,});
  });

  it('does not describe a presentation when no question is pending', async () => {
    runtimeMock.mockResolvedValue({
      state: createInitialPlanningIntakeState(), message: '了解しました。', draftCandidates: [],
      stableV5Graph: createEmptyWeeklyPlanningFactGraphV5(),
    });
    rendererMock.mockResolvedValue({ status: 'rendered', text: '了解しました。', rawResponse: '{}' });

    const result = await execute();

    expect(result).not.toHaveProperty('questionPresentationContent');
  });

  it('does not describe a presentation for a system message', async () => {
    runtimeMock.mockResolvedValue({
      state: questionState(), message: 'AIに接続できませんでした。', draftCandidates: [],
      responseSource: 'system',
      questionPresentationContent: {
        responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
      groundingContext: { proposed: 0, contested: 0 },
      previewPromotionControl: false,},
    });

    const result = await execute();

    expect(rendererMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('questionPresentationContent');
  });

  it('does not carry an old AI question presentation through a recorded technical failure', async () => {
    // Reproduce the unsafe output shape at the real failure-projector boundary.
    // This does not claim main has #563's P2 verifier or exercise a live provider.
    failureMock.mockReturnValueOnce(null).mockReturnValueOnce({
      status: 'normalization_rejected', attemptCount: 2, repairAttempted: true,
      validationErrorCategories: ['invalid_json'], canonicalizationErrorCategories: [],
      canonicalizationErrors: [], providerErrorCategory: null, traceCode: 'recovery-correspondence-fixture',
    });
    runtimeMock.mockResolvedValue({
      state: questionState(), message: '返信を作れませんでした。もう一度送信してください。',
      draftCandidates: [], responseSource: 'system',
      questionPresentationContent: {
        responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false,
      },
      questionPresentationGraphRevision: 3,
    });

    const result = await execute();

    expect(result.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(result.responseSource).toBe('system');
    expect(rendererMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('questionPresentationContent');
    expect(result).not.toHaveProperty('questionPresentationGraphRevision');
  });

  it('forwards the turn start revision to the Stable V5 runtime', async () => {
    runtimeMock.mockResolvedValue({
      state: createInitialPlanningIntakeState(), message: '了解しました。', draftCandidates: [],
    });
    rendererMock.mockResolvedValue({ status: 'rendered', text: '了解しました。', rawResponse: '{}' });

    await executeWeeklyPlanningTurn({
      messages: [], userText: 'いいえ', selectedDate: '2026-08-11', userId: 'user-1',
      plans: [], scheduleTemplates: [], conversationId: 'conversation-1', traceRequestId: TURN_ID,
      inputStateRevision: 9,
    });

    expect(runtimeMock).toHaveBeenCalledWith(expect.objectContaining({ inputStateRevision: 9 }));
  });

  it('counts the unresolved grounding interpretations the renderer may mention with the question', async () => {
    const grounding = (id: string, status: 'proposed' | 'contested' | 'rejected' | 'explicitly_accepted') => ({
      id,
      targetFactId: 'window-1',
      interpretationKind: 'relative_date_resolution' as const,
      status,
      sourceExpression: '来週',
      startDate: '2026-08-17',
      endDate: '2026-08-23',
      proposedAtTurnId: 'turn-1',
      acceptedAtTurnId: status === 'explicitly_accepted' ? 'turn-1' : null,
    });
    runtimeMock.mockResolvedValue({
      state: {
        ...questionState(),
        groundingRecords: [
          grounding('g-proposed', 'proposed'),
          grounding('g-contested', 'contested'),
          grounding('g-rejected', 'rejected'),
          grounding('g-accepted', 'explicitly_accepted'),
        ],
      },
      message: '確認してください。', draftCandidates: [],
      stableV5Graph: createEmptyWeeklyPlanningFactGraphV5(),
    });
    rendererMock.mockResolvedValue({ status: 'rendered', text: '確認してください。', rawResponse: '{}' });

    const result = await execute();

    expect(result.questionPresentationContent).toEqual({
      responseSource: 'ai',
      currentTurnGrounding: 'none',
      selfRepairNotice: false,
      groundingContext: { proposed: 1, contested: 1 },
      previewPromotionControl: false,
    });
  });
});

describe('R0 failure recovery projection gates', () => {
  beforeEach(() => {
    runtimeMock.mockReset(); rendererMock.mockReset(); failureMock.mockReset();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });
  afterEach(() => resetWeeklyPlanningStableV5RuntimeSessionsForTest());

  function prepared(overrides: { count?: number; anyFailure?: boolean; complete?: boolean;
    unknownCount?: boolean; providerFailure?: boolean; owner?: string; staleQuestion?: boolean;
    current?: () => boolean; withoutGuard?: boolean } = {}) {
    const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.revision = 3;
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: overrides.owner ?? 'user-1',
      weekStartDate: '2026-08-10', conversationId: 'conversation-1', graph });
    const previousState = bindWeeklyPlanningQuestionPresentation({
      state: { ...questionState(), lastQuestionContext: { kind: 'missing',
        targetSlot: 'stable_v5:missing_schedulable_work', intent: 'missing_task_identity', actionId: 'held-question' } },
      turnId: 'held', assistantMessageId: 'held:assistant', planningStateRevision: 8,
      graphRevision: 3, content: { responseSource: 'ai', currentTurnGrounding: 'none',
        selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false },
    });
    failureMock.mockReturnValueOnce(null).mockReturnValueOnce({
      status: overrides.providerFailure ? 'provider_failure' : 'normalization_rejected',
      attemptCount: 2, repairAttempted: true, validationErrorCategories: ['invalid_json'],
      canonicalizationErrorCategories: [], canonicalizationErrors: [],
      providerErrorCategory: overrides.providerFailure ? 'provider_error' : null, traceCode: 'recovery-gate',
      ...(overrides.unknownCount ? {} : { providerDispatch: { count: overrides.count ?? 2,
        anyFailure: overrides.anyFailure ?? false, complete: overrides.complete ?? true } }),
    });
    runtimeMock.mockResolvedValue({ state: questionState(), message: 'untrusted runtime failure',
      draftCandidates: [], questionPresentationContent: previousState.lastQuestionContext!.presentation!.content });
    rendererMock.mockResolvedValue({ status: 'rendered', recoveryVerified: true,
      text: '今回はまだ反映していません。以前の候補はそのままです。予定に入れたい作業は何ですか？', rawResponse: '{}' });
    return { previousState, messages: [{ id: 'held:assistant', role: 'assistant' as const,
      content: '予定に入れたい作業は何ですか？', createdAt: '2026-08-11T00:00:00Z' }],
      inputStateRevision: overrides.staleQuestion ? 9 : 8, userText: 'それは', selectedDate: '2026-08-11',
      userId: 'user-1', plans: [], scheduleTemplates: [], conversationId: 'conversation-1',
      traceRequestId: TURN_ID, retainedPreviewCount: 3,
      ...(overrides.withoutGuard ? {} : { isCurrentTurn: overrides.current ?? (() => true) }),
    };
  }

  it('uses only accepted typed question facts and emits a verified-recovery binding receipt', async () => {
    const result = await executeWeeklyPlanningTurn(prepared({ count: 6 }));
    expect(rendererMock).toHaveBeenCalledTimes(1); // Adapter owns generation + verification, not this facade.
    expect(rendererMock.mock.calls[0][0]).toMatchObject({ actionKind: 'question',
      questionCode: 'missing_schedulable_work',
      questionIntent: { kind: 'schedulable_work_detail', mode: 'missing_task_identity' },
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
      planningInformation: expect.objectContaining({ groundingRecords: [] }),
      recoveryQuestionEvidence: { facts: [], labels: [] },
      recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true, retainedPreviewUnchanged: true } });
    expect(result.responseSource).toBe('ai');
    expect(result.failure?.userMessage).toBe(result.message);
    expect(result.recoveryPresentation?.question).toEqual({ graphRevision: 3, previousAssistantMessageId: 'held:assistant' });
    expect(result.questionPresentationContent?.responseSource).toBe('ai');
    expect(result.draftCandidates).toEqual([]);
    expect(result.stableV5Graph).toBeUndefined();
  });

  it.each([
    { name: 'provider failure', providerFailure: true },
    { name: 'earlier provider throw then success', anyFailure: true },
    { name: 'one remaining call', count: 7 },
    { name: 'unknown count', unknownCount: true },
    { name: 'unsettled request', complete: false },
    { name: 'stale or aborted controller', current: () => false },
    { name: 'unknown current owner', withoutGuard: true },
    { name: 'changed owner', owner: 'other-owner' },
  ])('does not add a recovery call after $name', async (options) => {
    const result = await executeWeeklyPlanningTurn(prepared(options));
    expect(rendererMock).not.toHaveBeenCalled();
    expect(result.responseSource).toBe('system');
    expect(result).not.toHaveProperty('questionPresentationContent');
    expect(result).not.toHaveProperty('recoveryPresentation');
  });

  it('does not carry stale question authority into recovery wording', async () => {
    const result = await executeWeeklyPlanningTurn(prepared({ staleQuestion: true }));
    expect(rendererMock.mock.calls[0][0]).toMatchObject({ actionKind: 'status', questionCode: null,
      questionTarget: null, questionIntent: null });
    expect(result.recoveryPresentation).toEqual({ question: null });
    expect(result).not.toHaveProperty('questionPresentationContent');
  });

  it.each(['missing_schedulable_work', 'quantity_role_unresolved', 'semantic_uncertainty'])(
    'never rebinds a fresh-shaped but dangling %s target', async (code) => {
      const input = prepared();
      input.previousState.lastQuestionContext = { ...input.previousState.lastQuestionContext!,
        targetSlot: `stable_v5:${code}`, topicId: 'removed-target', intent: code };
      const result = await executeWeeklyPlanningTurn(input);
      expect(rendererMock).not.toHaveBeenCalled();
      expect(result.responseSource).toBe('system');
      expect(result).not.toHaveProperty('recoveryPresentation');
    });

  it('rejects a target-bearing code with its target missing rather than creating a general question', async () => {
    const input = prepared();
    input.previousState.lastQuestionContext = { ...input.previousState.lastQuestionContext!,
      targetSlot: 'stable_v5:quantity_role_unresolved', intent: 'quantity_role_unresolved' };
    expect((await executeWeeklyPlanningTurn(input)).responseSource).toBe('system');
    expect(rendererMock).not.toHaveBeenCalled();
  });

  it.each(['matching', 'other_active_workload', 'removed_workload', 'missing_workload',
    'other_task_owner', 'duplicate_record', 'missing_record'])(
    'checks proposal topic, intent and canonical workload owner before recovery (%s)', async (scenario) => {
      const input = prepared();
      const accepted = graphWithCurrentTurnCorrection(); accepted.revision = 3;
      accepted.tasks.push({ ...accepted.tasks[0], id: 'other-task', title: '数学' });
      accepted.workloads.push({ ...accepted.workloads[1], id: 'other-workload', taskId: 'other-task' });
      accepted.factLifecycles.push(...['other-task', 'other-workload'].map((factId) => ({
        factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null,
      })));
      hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: 'user-1', weekStartDate: '2026-08-10',
        conversationId: 'conversation-1', graph: accepted });
      input.previousState.lastQuestionContext = { ...input.previousState.lastQuestionContext!, kind: 'options',
        targetSlot: 'stable_v5:learning_strategy_proposal', topicId: 'new', actionId: 'proposal-1',
        intent: 'accept_or_reject' };
      const proposal = { id: 'proposal-1', kind: 'spaced_memory_practice' as const,
        taskId: scenario === 'other_task_owner' ? 'other-task' : 'task-english',
        workloadFactId: scenario === 'other_active_workload' ? 'other-workload'
          : scenario === 'removed_workload' ? 'old' : scenario === 'missing_workload' ? 'missing' : 'new',
        scope: 'week' as const, status: 'pending' as const, suggestedSessionMinutes: { min: 15, max: 30 },
        createdRevision: 1, proposedAtTurnId: 'held', decidedAtTurnId: null };
      input.previousState.learningStrategyProposalRecords = scenario === 'missing_record' ? []
        : scenario === 'duplicate_record' ? [proposal, { ...proposal }] : [proposal];
      const result = await executeWeeklyPlanningTurn(input);
      if (scenario === 'matching') {
        expect(rendererMock).toHaveBeenCalledTimes(1);
        expect(rendererMock.mock.calls[0][0]).toMatchObject({ questionCode: 'learning_strategy_proposal',
          questionTarget: { collection: 'workloads', fact: { id: 'new', taskId: 'task-english' } },
          questionIntent: { kind: 'learning_strategy_proposal', targetFactId: 'new' },
          recoveryQuestionEvidence: { labels: ['英単語'] } });
        expect(result.recoveryPresentation?.question).toEqual({ graphRevision: 3, previousAssistantMessageId: 'held:assistant' });
      } else {
        expect(rendererMock).not.toHaveBeenCalled();
        expect(result.responseSource).toBe('system');
        expect(result).not.toHaveProperty('recoveryPresentation');
      }
    });

  it('keeps verification failures as technical stops without a new question binding', async () => {
    const input = prepared();
    rendererMock.mockResolvedValue({ status: 'fallback', reason: 'recovery_verification_failed', rawResponse: '{}' });
    const result = await executeWeeklyPlanningTurn(input);
    expect(result.responseSource).toBe('system');
    expect(result).not.toHaveProperty('recoveryPresentation');
    expect(result).not.toHaveProperty('questionPresentationContent');
  });

  it('does not adopt a verified result after the controller was cancelled during rendering', async () => {
    let current = true;
    const input = prepared({ current: () => current });
    rendererMock.mockImplementation(async () => { current = false; return {
      status: 'rendered', recoveryVerified: true, text: 'ignored', rawResponse: '{}' }; });
    const result = await executeWeeklyPlanningTurn(input);
    expect(result.responseSource).toBe('system');
    expect(result).not.toHaveProperty('recoveryPresentation');
  });
});
