import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningBehaviorAwarePipelineOutput } from './pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';

const runRulesPipelineMock = vi.hoisted(() => vi.fn());
const runAiPipelineMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'rules' }),
  getAiConfigValidationMessage: () => undefined,
}));

vi.mock('./pipeline/weeklyPlanningBehaviorAwareIntakePipeline', () => ({
  runWeeklyPlanningBehaviorAwarePipeline: runRulesPipelineMock,
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter: runAiPipelineMock,
}));

function pipelineOutput(): WeeklyPlanningBehaviorAwarePipelineOutput {
  return {
    state: createInitialPlanningIntakeState(),
    behaviorDialogue: { message: '確認しました。' },
    draftCandidates: [],
  } as unknown as WeeklyPlanningBehaviorAwarePipelineOutput;
}

describe('executeWeeklyPlanningTurn', () => {
  beforeEach(() => {
    runRulesPipelineMock.mockReset();
    runAiPipelineMock.mockReset();
    runRulesPipelineMock.mockResolvedValue(pipelineOutput());
  });

  it('passes the controlled conversationId to the production pipeline options', async () => {
    await executeWeeklyPlanningTurn({
      messages: [],
      userText: '来週の予定を立てたい',
      selectedDate: '2026-07-20',
      userId: 'user-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'weekly-conversation-real',
      traceRequestId: 'weekly-conversation-real:request:1',
    });

    expect(runRulesPipelineMock).toHaveBeenCalledTimes(1);
    expect(runRulesPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({ userText: '来週の予定を立てたい' }),
      expect.objectContaining({
        userId: 'user-1',
        conversationId: 'weekly-conversation-real',
        traceRequestId: 'weekly-conversation-real:request:1',
      }),
    );
    expect(runAiPipelineMock).not.toHaveBeenCalled();
  });
});
