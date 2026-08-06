import { describe, expect, it } from 'vitest';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION,
  parseWeeklyPlanningResumableConversationCheckpoint,
  serializeWeeklyPlanningResumableConversationCheckpoint,
  type WeeklyPlanningResumableConversationCheckpoint,
} from './weeklyPlanningResumableConversationCheckpoint';

function checkpoint(): WeeklyPlanningResumableConversationCheckpoint {
  return {
    version: WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION,
    ownerId: 'owner-1',
    conversationId: 'conversation-1',
    weekStartDate: '2026-08-03',
    selectedDate: '2026-08-06',
    planningState: createInitialPlanningState('2026-08-03'),
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    turns: [],
    savedAt: '2026-08-06T14:00:00.000Z',
  };
}

describe('weeklyPlanningResumableConversationCheckpoint', () => {
  it('round-trips a valid checkpoint', () => {
    const value = checkpoint();
    expect(parseWeeklyPlanningResumableConversationCheckpoint(
      serializeWeeklyPlanningResumableConversationCheckpoint(value),
    )).toEqual(value);
  });

  it('rejects a checkpoint with a non-contiguous transcript', () => {
    const value = checkpoint();
    value.turns = [{
      index: 2,
      userText: '予定を立てたいです',
      assistantText: 'いつまでの予定ですか？',
      requestId: 'request-2',
      responseSource: 'ai',
      graphRevision: 1,
      createdAt: '2026-08-06T14:01:00.000Z',
    }];
    expect(() => parseWeeklyPlanningResumableConversationCheckpoint(
      serializeWeeklyPlanningResumableConversationCheckpoint(value),
    )).toThrow('turn indexes are not contiguous');
  });

  it('rejects an in-flight planning state', () => {
    const value = checkpoint();
    value.planningState.pendingTurn = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      weekStartDate: '2026-08-03',
      baseRevision: 0,
      startedAt: '2026-08-06T14:00:00.000Z',
    };
    expect(() => parseWeeklyPlanningResumableConversationCheckpoint(
      serializeWeeklyPlanningResumableConversationCheckpoint(value),
    )).toThrow('in-flight operation');
  });
});
