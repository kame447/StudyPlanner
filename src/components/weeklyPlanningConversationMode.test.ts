import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import { resolveInitialAiInputMode } from './weeklyPlanningConversationMode';

const pendingTurn = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:1',
  requestId: 'request-1',
  weekStartDate: '2026-07-13',
  baseRevision: 0,
  startedAt: '2026-07-16T00:00:00.000Z',
};

describe('weekly planning session resume mode', () => {
  it.each([
    { messages: [{ id: 'm1', role: 'user' as const, content: '予定', createdAt: pendingTurn.startedAt }], intakeState: null },
    { messages: [], intakeState: createInitialPlanningIntakeState() },
    { messages: [], intakeState: null, draftBlockCount: 1 },
    { messages: [], intakeState: null, pendingTurn },
  ])('reopens the weekly AI view for an active session', (session) => {
    expect(resolveInitialAiInputMode(session)).toBe('weekly_planning');
  });

  it('keeps the chat default without a saved weekly session', () => {
    expect(resolveInitialAiInputMode({ messages: [], intakeState: null })).toBe('chat');
  });
});
