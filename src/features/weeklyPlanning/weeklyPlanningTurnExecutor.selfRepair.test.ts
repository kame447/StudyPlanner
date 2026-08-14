import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
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

function correctedGraph() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  const source = (turnId: string, localId: string, text: string) => ({
    conversationId: 'conversation-1', turnId, semanticLocalId: localId, sourceText: text, origin: 'user' as const,
  });
  graph.revision = 2;
  graph.tasks = [{ id: 'task-english', category: 'study', title: '英単語', source: source('turn-1', 'task', '英単語'), createdRevision: 1 }];
  graph.workloads = [
    { id: 'old', taskId: 'task-english', componentId: null, quantityRole: 'target', amount: 80, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source: source('turn-1', 'old', '80ページ'), createdRevision: 1 },
    { id: 'new', taskId: 'task-english', componentId: null, quantityRole: 'target', amount: 80, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source: source('request-2', 'new', '80語だよ'), createdRevision: 2 },
  ];
  graph.correctionIntents = [{
    id: 'correction', target: { kind: 'workload', publicId: 'old', factId: 'old', mention: '80ページ' },
    operation: 'replace', replacementFactId: 'new', source: source('request-2', 'correction', '80語だよ'), createdRevision: 2,
  }];
  graph.factLifecycles = [
    { factId: 'task-english', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
    { factId: 'old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'new' },
    { factId: 'new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    { factId: 'correction', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
  ];
  return graph;
}

describe('Stable V5 self-repair rendering integration', () => {
  beforeEach(() => {
    runtimeMock.mockReset(); rendererMock.mockReset(); failureMock.mockReset();
    failureMock.mockReturnValue(null);
  });

  it('uses the successful AI rendering as the complete correction response', async () => {
    runtimeMock.mockResolvedValue({
      state: createInitialPlanningIntakeState(), message: '次の条件を確認します。', draftCandidates: [],
      stableV5Graph: correctedGraph(),
    });
    rendererMock.mockResolvedValue({
      status: 'rendered',
      text: '英単語を80語に修正しました。次の条件を確認します。',
      rawResponse: '{}',
    });

    const result = await executeWeeklyPlanningTurn({
      messages: [], userText: '80語だよ', selectedDate: '2026-08-11', userId: 'user-1',
      plans: [], scheduleTemplates: [], conversationId: 'conversation-1', traceRequestId: 'request-2',
    });

    expect(result.message).toBe('英単語を80語に修正しました。次の条件を確認します。');
    expect(result.message).not.toContain('80ページではなく80語ですね');
    expect(result.message).not.toContain('数学');
  });

  it('keeps the deterministic correction acknowledgement when rendering falls back', async () => {
    runtimeMock.mockResolvedValue({
      state: createInitialPlanningIntakeState(), message: '次の条件を確認します。', draftCandidates: [],
      stableV5Graph: correctedGraph(),
    });
    rendererMock.mockResolvedValue({
      status: 'fallback',
      reason: 'provider_error',
      rawResponse: null,
    });

    const result = await executeWeeklyPlanningTurn({
      messages: [], userText: '80語だよ', selectedDate: '2026-08-11', userId: 'user-1',
      plans: [], scheduleTemplates: [], conversationId: 'conversation-1', traceRequestId: 'request-2',
    });

    expect(result.message).toBe(
      '英単語は80ページではなく80語ですね。修正しました。 次の条件を確認します。',
    );
    expect(result.responseSource).toBe('deterministic_fallback');
  });
});
