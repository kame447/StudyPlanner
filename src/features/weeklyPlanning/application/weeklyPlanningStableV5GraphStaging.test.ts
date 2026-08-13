import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  readWeeklyPlanningStableV5StagedGraph,
  resetWeeklyPlanningStableV5GraphStagesForTest,
  stageWeeklyPlanningStableV5Graph,
} from './weeklyPlanningStableV5GraphStaging';

function graphFor(conversationId: string, requestId: string, revision: number) {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision,
    appliedTurnKeys: [`${conversationId}:${requestId}`],
  };
}

describe('Stable V5 graph staging resource bounds', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5GraphStagesForTest();
  });

  it('bounds orphaned staged graphs and evicts the oldest entry first', () => {
    for (let index = 0; index < 129; index += 1) {
      const conversationId = `conversation-${index}`;
      stageWeeklyPlanningStableV5Graph({
        ownerId: 'owner-1',
        conversationId,
        graph: graphFor(conversationId, `request-${index}`, index + 1),
      });
    }

    expect(readWeeklyPlanningStableV5StagedGraph({
      conversationId: 'conversation-0',
      requestId: 'request-0',
    })).toBeNull();
    expect(readWeeklyPlanningStableV5StagedGraph({
      conversationId: 'conversation-1',
      requestId: 'request-1',
    })).not.toBeNull();
    expect(readWeeklyPlanningStableV5StagedGraph({
      conversationId: 'conversation-128',
      requestId: 'request-128',
    })).not.toBeNull();
  });

  it('refreshes a repeated request instead of consuming another staging slot', () => {
    stageWeeklyPlanningStableV5Graph({
      ownerId: 'owner-1',
      conversationId: 'conversation-repeat',
      graph: graphFor('conversation-repeat', 'request-1', 1),
    });
    stageWeeklyPlanningStableV5Graph({
      ownerId: 'owner-1',
      conversationId: 'conversation-repeat',
      graph: graphFor('conversation-repeat', 'request-1', 2),
    });

    expect(readWeeklyPlanningStableV5StagedGraph({
      conversationId: 'conversation-repeat',
      requestId: 'request-1',
    })?.graph.revision).toBe(2);
  });
});
