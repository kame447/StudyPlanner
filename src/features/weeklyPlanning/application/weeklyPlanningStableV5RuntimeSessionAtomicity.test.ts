import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  commitWeeklyPlanningStableV5RuntimeGraph,
  discardWeeklyPlanningStableV5StagedGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt,
  getWeeklyPlanningStableV5RuntimeSession,
  hasWeeklyPlanningStableV5StagedGraph,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
  rollbackWeeklyPlanningStableV5RuntimeGraphFinalize,
} from './weeklyPlanningStableV5RuntimeSession';

const OWNER_ID = 'owner-1';
const WEEK_START = '2026-07-20';
const CONVERSATION_ID = 'conversation-1';

function graphForRequest(requestId: string, revision: number) {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision,
    appliedTurnKeys: [`${CONVERSATION_ID}:${requestId}`],
  };
}

describe('Stable V5 runtime Graph atomicity', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
    });
  });

  it('keeps a semantic result staged until the controller accepts the turn', () => {
    const graph = graphForRequest('request-1', 1);

    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      graph,
    });

    expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION_ID)?.graph.revision).toBe(0);
    expect(hasWeeklyPlanningStableV5StagedGraph({
      conversationId: CONVERSATION_ID,
      requestId: 'request-1',
    })).toBe(true);

    finalizeWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      requestId: 'request-1',
    });

    expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION_ID)?.graph).toEqual(graph);
    expect(hasWeeklyPlanningStableV5StagedGraph({
      conversationId: CONVERSATION_ID,
      requestId: 'request-1',
    })).toBe(false);
  });

  it('rolls a prepared graph commit back to the exact previous runtime graph', () => {
    const graph = graphForRequest('request-1', 1);
    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      graph,
    });

    const prepared = finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      requestId: 'request-1',
    });
    expect(prepared.session.graph).toEqual(graph);

    expect(rollbackWeeklyPlanningStableV5RuntimeGraphFinalize(prepared.receipt)).toBe(true);
    expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION_ID)?.graph.revision).toBe(0);
  });

  it('does not let an old rollback receipt overwrite a newer graph', () => {
    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      graph: graphForRequest('request-1', 1),
    });
    const first = finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      requestId: 'request-1',
    });

    const secondGraph = graphForRequest('request-2', 2);
    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      graph: secondGraph,
    });
    finalizeWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      requestId: 'request-2',
    });

    expect(rollbackWeeklyPlanningStableV5RuntimeGraphFinalize(first.receipt)).toBe(false);
    expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION_ID)?.graph).toEqual(secondGraph);
  });

  it('discards a staged Graph without changing the committed conversation state', () => {
    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      graph: graphForRequest('request-stale', 1),
    });

    discardWeeklyPlanningStableV5StagedGraph({
      conversationId: CONVERSATION_ID,
      requestId: 'request-stale',
    });

    expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION_ID)?.graph.revision).toBe(0);
    expect(hasWeeklyPlanningStableV5StagedGraph({
      conversationId: CONVERSATION_ID,
      requestId: 'request-stale',
    })).toBe(false);
  });

  it('rejects a turn key from another conversation', () => {
    expect(() => commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      graph: {
        ...createEmptyWeeklyPlanningFactGraphV5(),
        revision: 1,
        appliedTurnKeys: ['other-conversation:request-1'],
      },
    })).toThrow('conversation does not match');
  });
});
