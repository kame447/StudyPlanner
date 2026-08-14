import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningMessage } from './types';
import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';

const stableV5RuntimeMock = vi.hoisted(() => vi.fn());
const stableV5RendererMock = vi.hoisted(() => vi.fn());
const takeStableV5FailureMock = vi.hoisted(() => vi.fn());
const recordStableV5DebugTraceMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => ({
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: 'configured-model',
    apiKey: 'test-key',
  }),
  getAiConfigValidationMessage: () => undefined,
}));

vi.mock('./application/weeklyPlanningStableV5InstrumentedRuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: stableV5RuntimeMock,
}));

vi.mock('./semantic/weeklyPlanningStableV5FailureDiagnostics', () => ({
  takeWeeklyPlanningStableV5FailureDiagnostics: takeStableV5FailureMock,
}));

vi.mock('./trace/weeklyPlanningStableV5DebugTrace', () => ({
  recordWeeklyPlanningStableV5DebugTrace: recordStableV5DebugTraceMock,
}));

vi.mock('./dialogue/weeklyPlanningStableV5AiDialogueRenderer', () => ({
  createAiWeeklyPlanningStableV5DialogueRenderer: () => ({
    render: stableV5RendererMock,
  }),
}));

vi.mock('./dialogue/weeklyPlanningAiDialogueRenderer', () => ({
  createAiWeeklyPlanningDialogueRenderer: () => ({ render: vi.fn() }),
}));

vi.mock('./dialogue/weeklyPlanningDialogueRenderer', () => ({
  renderWeeklyPlanningDialogueMessage: vi.fn(),
}));

vi.mock('./pipeline/weeklyPlanningBehaviorAwareIntakePipeline', () => ({
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter: vi.fn(),
}));

function message(
  id: string,
  role: WeeklyPlanningMessage['role'],
  content: string,
): WeeklyPlanningMessage {
  return {
    id,
    role,
    content,
    createdAt: '2026-07-31T00:00:00.000Z',
  };
}

function stableV5Result() {
  const fallback = '院試の第2分野の3時間は、今回進めたい量ですか、それとも残っている全体量ですか？';
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  const source = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: 'local-1',
    sourceText: '院試は2分野それぞれ3時間やりたい',
    origin: 'user' as const,
  };

  graph.revision = 4;
  graph.planningWindows = [{
    id: 'window-1',
    kind: 'relative_week',
    value: '来週',
    start: '2026-08-03',
    end: '2026-08-09',
    source,
    createdRevision: 1,
  }];
  graph.tasks = [{
    id: 'task-1',
    category: 'study',
    title: '院試',
    source,
    createdRevision: 1,
  }];
  graph.components = [{
    id: 'component-1',
    taskId: 'task-1',
    parentComponentId: null,
    role: 'field',
    label: '第2分野',
    source,
    createdRevision: 2,
  }];
  graph.workloads = [{
    id: 'workload-1',
    taskId: 'task-1',
    componentId: 'component-1',
    quantityRole: 'unknown',
    amount: 3,
    unitCode: 'hour',
    unitLabel: '時間',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source,
    createdRevision: 3,
  }];
  graph.uncertainties = [{
    id: 'uncertainty-1',
    targetFactId: 'workload-1',
    field: 'quantityRole',
    reason: '今回進める量か残っている全体量か不明',
    source,
    createdRevision: 4,
  }];

  return {
    state: {
      ...createInitialPlanningIntakeState(),
      status: 'revision_pending' as const,
      questions: [fallback],
      groundingRecords: [{
        id: 'grounding:window-1:2026-08-03:2026-08-09',
        targetFactId: 'window-1',
        interpretationKind: 'relative_date_resolution' as const,
        status: 'proposed' as const,
        sourceExpression: '来週',
        startDate: '2026-08-03',
        endDate: '2026-08-09',
        proposedAtTurnId: 'turn-1',
        acceptedAtTurnId: null,
      }],
      lastQuestionContext: {
        kind: 'missing' as const,
        targetSlot: 'stable_v5:quantity_role_unresolved',
        intent: 'quantity_role_unresolved',
      },
    },
    message: fallback,
    draftCandidates: [],
    stableV5Graph: graph,
  };
}

describe('Stable V5 dialogue context wiring', () => {
  beforeEach(() => {
    stableV5RuntimeMock.mockReset();
    stableV5RendererMock.mockReset();
    takeStableV5FailureMock.mockReset();
    takeStableV5FailureMock.mockReturnValue(null);
    recordStableV5DebugTraceMock.mockReset();
  });

  it('passes recent conversation, typed planning facts, and grounding records to the renderer', async () => {
    const messages = [
      message('1', 'user', 'この発話だけは古いので除外される'),
      message('2', 'assistant', '来週の計画ですね。'),
      message('3', 'user', '院試の勉強をしたい'),
      message('4', 'assistant', '分野を教えてください。'),
      message('5', 'user', '第1分野と第2分野'),
      message('6', 'assistant', '作業量を教えてください。'),
      message('7', 'user', 'それぞれ3時間'),
    ];
    stableV5RuntimeMock.mockResolvedValue(stableV5Result());
    stableV5RendererMock.mockResolvedValue({
      status: 'rendered',
      text: '3時間が今週やる分なのか、残り全部なのかを確認しています。',
      rawResponse: '{"actionId":"ok"}',
    });

    await executeWeeklyPlanningTurn({
      messages,
      userText: 'どういうこと？',
      selectedDate: '2026-08-03',
      userId: 'user-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-1',
      traceRequestId: 'conversation-1:request:2',
    });

    expect(stableV5RendererMock).toHaveBeenCalledWith(expect.objectContaining({
      currentUserMessage: 'どういうこと？',
      recentConversation: [
        { role: 'assistant', content: '分野を教えてください。' },
        { role: 'user', content: '第1分野と第2分野' },
        { role: 'assistant', content: '作業量を教えてください。' },
        { role: 'user', content: 'それぞれ3時間' },
      ],
      planningInformation: expect.objectContaining({
        revision: 4,
        planningWindows: [expect.objectContaining({
          value: '来週',
          start: '2026-08-03',
          end: '2026-08-09',
        })],
        groundingRecords: [expect.objectContaining({
          status: 'proposed',
          sourceExpression: '来週',
          startDate: '2026-08-03',
          endDate: '2026-08-09',
        })],
        tasks: [expect.objectContaining({ title: '院試' })],
        components: [expect.objectContaining({ label: '第2分野' })],
        workloads: [expect.objectContaining({
          quantityRole: 'unknown',
          amount: 3,
          unitLabel: '時間',
        })],
        uncertainties: [expect.objectContaining({
          field: 'quantityRole',
          reason: '今回進める量か残っている全体量か不明',
        })],
      }),
      questionCode: 'quantity_role_unresolved',
    }));
  });
});
