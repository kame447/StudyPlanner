import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import { resolveInitialAiInputMode } from './weeklyPlanningConversationMode';

describe('resolveInitialAiInputMode', () => {
  it('reopens weekly planning when messages exist', () => {
    expect(resolveInitialAiInputMode({
      messages: [{
        id: 'message-1',
        role: 'user',
        content: '予定を作りたい',
        createdAt: '2026-07-16T00:00:00.000Z',
      }],
      intakeState: null,
    })).toBe('weekly_planning');
  });

  it('reopens weekly planning when only intake state exists', () => {
    expect(resolveInitialAiInputMode({
      messages: [],
      intakeState: createInitialPlanningIntakeState(),
    })).toBe('weekly_planning');
  });

  it('keeps chat as the default without a saved session', () => {
    expect(resolveInitialAiInputMode({ messages: [], intakeState: null })).toBe('chat');
  });
});
