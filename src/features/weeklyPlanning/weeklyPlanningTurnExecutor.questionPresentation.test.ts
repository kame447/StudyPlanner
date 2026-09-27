import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    });
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
    });
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
      },
    });

    const result = await execute();

    expect(rendererMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('questionPresentationContent');
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
});
