import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';

const stableV5RuntimeMock = vi.hoisted(() => vi.fn());
const stableV5RendererMock = vi.hoisted(() => vi.fn());
const takeStableV5FailureMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.test/v1', model: 'model', apiKey: 'key' }),
}));
vi.mock('./application/weeklyPlanningStableV5InstrumentedRuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: stableV5RuntimeMock,
}));
vi.mock('./semantic/weeklyPlanningStableV5FailureDiagnostics', () => ({
  takeWeeklyPlanningStableV5FailureDiagnostics: takeStableV5FailureMock,
}));
vi.mock('./trace/weeklyPlanningStableV5DebugTrace', () => ({
  recordWeeklyPlanningStableV5DebugTrace: vi.fn(),
}));
vi.mock('./dialogue/weeklyPlanningStableV5AiDialogueRenderer', () => ({
  createAiWeeklyPlanningStableV5DialogueRenderer: () => ({ render: stableV5RendererMock }),
}));

function runtimeResult() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  const source = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: 'local-1',
    sourceText: '夜じゃなくて朝にして',
    origin: 'user' as const,
  };
  graph.revision = 3;
  graph.tasks = [
    { id: 'task-old', category: 'study', title: '古い数学', source, createdRevision: 1 },
    { id: 'task-new', category: 'study', title: '数学', source, createdRevision: 2 },
  ];
  graph.temporalConstraints = [
    {
      id: 'time-old', taskId: 'task-new', targetFactId: 'task-new', kind: 'preferred_window',
      constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null,
      endTime: null, precision: 'unspecified', source, createdRevision: 1,
    },
    {
      id: 'time-new', taskId: 'task-new', targetFactId: 'task-new', kind: 'preferred_window',
      constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'morning', startTime: null,
      endTime: null, precision: 'unspecified', source, createdRevision: 2,
    },
  ];
  graph.factLifecycles = [
    { factId: 'task-old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'task-new' },
    { factId: 'task-new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    { factId: 'time-old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'time-new' },
    { factId: 'time-new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
  ];
  return {
    state: createInitialPlanningIntakeState(),
    message: '条件を更新しました。',
    draftCandidates: [],
    stableV5Graph: graph,
  };
}

describe('Stable V5 active dialogue projection integration', () => {
  beforeEach(() => {
    stableV5RuntimeMock.mockReset();
    stableV5RendererMock.mockReset();
    takeStableV5FailureMock.mockReset();
    takeStableV5FailureMock.mockReturnValue(null);
  });

  it('passes only active replacement facts to the AI renderer after a correction', async () => {
    stableV5RuntimeMock.mockResolvedValue(runtimeResult());
    stableV5RendererMock.mockResolvedValue({
      status: 'rendered',
      text: '朝の希望に更新しました。',
      rawResponse: '{"actionId":"ok"}',
    });

    await executeWeeklyPlanningTurn({
      messages: [],
      userText: '夜じゃなくて朝にして',
      selectedDate: '2026-08-11',
      userId: 'user-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-1',
      traceRequestId: 'conversation-1:request:1',
    });

    const rendererInput = stableV5RendererMock.mock.calls[0]?.[0];
    expect(rendererInput.planningInformation.tasks).toEqual([
      expect.objectContaining({ title: '数学' }),
    ]);
    expect(rendererInput.planningInformation.temporalConstraints).toEqual([
      expect.objectContaining({ namedTimePeriod: 'morning' }),
    ]);
    expect(JSON.stringify(rendererInput.planningInformation)).not.toContain('古い数学');
    expect(JSON.stringify(rendererInput.planningInformation)).not.toContain('night');
  });
});
