import { afterEach, describe, expect, it } from 'vitest';
import {
  clearWeeklyPlanningSessionRuntime,
  getWeeklyPlanningSessionRuntime,
  publishWeeklyPlanningSessionRuntime,
} from './weeklyPlanningSessionRuntime';

afterEach(() => clearWeeklyPlanningSessionRuntime());

describe('weeklyPlanningSessionRuntime', () => {
  it('publishes current revision and proposal history without exposing mutable references', () => {
    const source = [{
      proposalId: 'proposal-1',
      conversationId: 'conversation-1',
      slot: 'duration' as const,
      targetRef: 'task:0',
      proposedValue: 60,
      proposedUnit: 'minutes' as const,
      reasonCode: 'missing_duration' as const,
      sourceFactRefs: ['task:0'],
      createdAtTurnId: 'turn-1',
      createdFromStateRevision: 1,
      status: 'accepted' as const,
    }];
    const published = publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-1',
      stateRevision: 3,
      proposalRecords: source,
      updatedAt: 123,
    });
    published.proposalRecords[0].status = 'rejected';
    source[0].sourceFactRefs.push('mutated');

    expect(getWeeklyPlanningSessionRuntime()).toEqual({
      conversationId: 'conversation-1',
      stateRevision: 3,
      proposalRecords: [{
        proposalId: 'proposal-1',
        conversationId: 'conversation-1',
        slot: 'duration',
        targetRef: 'task:0',
        proposedValue: 60,
        proposedUnit: 'minutes',
        reasonCode: 'missing_duration',
        sourceFactRefs: ['task:0'],
        createdAtTurnId: 'turn-1',
        createdFromStateRevision: 1,
        status: 'accepted',
      }],
      updatedAt: 123,
    });
  });

  it('clears runtime on reset or reload boundary', () => {
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-1',
      stateRevision: 1,
      proposalRecords: [],
    });
    clearWeeklyPlanningSessionRuntime();
    expect(getWeeklyPlanningSessionRuntime()).toBeNull();
  });
});
