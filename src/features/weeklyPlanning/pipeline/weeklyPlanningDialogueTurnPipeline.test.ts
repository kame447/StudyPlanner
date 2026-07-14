import { describe, expect, it } from 'vitest';
import { createDialogueOrchestratorState } from '../dialogue/weeklyPlanningDialogueOrchestrator';
import type { WeeklyPlanningBehaviorAwarePipelineOutput } from './weeklyPlanningBehaviorAwareIntakePipeline';
import { runWeeklyPlanningDialogueTurn } from './weeklyPlanningDialogueTurnPipeline';

const output = {} as WeeklyPlanningBehaviorAwarePipelineOutput;

describe('weeklyPlanningDialogueTurnPipeline', () => {
  it('returns output only after the request remains current', async () => {
    const result = await runWeeklyPlanningDialogueTurn({
      orchestratorState: createDialogueOrchestratorState(),
      conversationId: 'conversation-1',
      inputStateRevision: 0,
      userText: '来週の予定を作りたい',
      createdAt: '2026-07-14T12:00:00Z',
      runPipeline: async () => output,
      currentStateRevision: () => 0,
    });

    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.output).toBe(output);
      expect(result.orchestratorState.phase).toBe('idle');
      expect(result.orchestratorState.activeEnvelope).toBeUndefined();
    }
  });

  it('discards a delayed result after the state revision changes', async () => {
    let revision = 0;
    const result = await runWeeklyPlanningDialogueTurn({
      orchestratorState: createDialogueOrchestratorState(),
      conversationId: 'conversation-1',
      inputStateRevision: 0,
      userText: '来週の予定を作りたい',
      createdAt: '2026-07-14T12:00:00Z',
      runPipeline: async () => {
        revision = 1;
        return output;
      },
      currentStateRevision: () => revision,
    });

    expect(result.accepted).toBe(false);
    if (!result.accepted && 'stale' in result) {
      expect(result.stale.reason).toBe('state_revision_mismatch');
    }
  });
});
